import assert from "node:assert/strict";
import test from "node:test";
import { decrypt, encrypt } from "../src/crypto.ts";
import * as accountStoreModule from "../src/mail/account-store.ts";

const oldKey = Buffer.alloc(32, 1).toString("base64");
const newKey = Buffer.alloc(32, 2).toString("base64");
const accounts = [
	{
		id: "account-1",
		name: "Example",
		email: "user@example.com",
		imap: { host: "imap.example.com", port: 993, secure: true },
		auth: { type: "password" as const, password: "app-password" },
	},
];

function secretBinding(value: string) {
	return {
		async get() {
			return value;
		},
	};
}

function memoryKv(initial: Record<string, ArrayBuffer> = {}) {
	const values = new Map<string, ArrayBuffer>(Object.entries(initial));
	return {
		values,
		async get(key: string) {
			return values.get(key) ?? null;
		},
		async put(key: string, value: ArrayBuffer) {
			values.set(key, value.slice(0));
		},
	};
}

test("AccountStore resolves a Secrets Store binding before decrypting account data", async () => {
	const encrypted = await encrypt(new TextEncoder().encode(JSON.stringify(accounts)), newKey);
	const kv = memoryKv({ "mail/accounts/v1": encrypted, "mail/accounts/v2": encrypted });
	const store = new accountStoreModule.AccountStore(
		kv as unknown as KVNamespace,
		secretBinding(newKey) as any,
	);

	assert.deepEqual(await store.list(), accounts);
});

test("account encryption migration preserves v1 and verifies a new v2 copy", async () => {
	const migrate = (accountStoreModule as any).migrateAccountStoreEncryption as
		| undefined
		| ((
				kv: KVNamespace,
				oldEncryptionKey: string,
				newEncryptionKey: { get(): Promise<string> },
		  ) => Promise<{ count: number; verified: boolean }>);
	assert.equal(typeof migrate, "function", "migration helper must be exported");
	if (!migrate) return;

	const original = await encrypt(new TextEncoder().encode(JSON.stringify(accounts)), oldKey);
	const originalBytes = Buffer.from(original);
	const kv = memoryKv({ "mail/accounts/v1": original });

	const result = await migrate(kv as unknown as KVNamespace, oldKey, secretBinding(newKey));

	assert.deepEqual(result, { count: 1, verified: true });
	assert.deepEqual(Buffer.from(kv.values.get("mail/accounts/v1")!), originalBytes);

	const migrated = kv.values.get("mail/accounts/v2");
	assert.ok(migrated, "migration must create mail/accounts/v2");
	const plaintext = await decrypt(migrated, newKey);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), accounts);
});
