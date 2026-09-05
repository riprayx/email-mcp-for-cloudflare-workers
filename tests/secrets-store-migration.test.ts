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

test("Secrets Store-backed AccountStore reads and writes v2 while legacy strings stay on v1", async () => {
	const v1Accounts = [{ ...accounts[0], name: "Legacy" }];
	const v1 = await encrypt(new TextEncoder().encode(JSON.stringify(v1Accounts)), oldKey);
	const v2 = await encrypt(new TextEncoder().encode(JSON.stringify(accounts)), newKey);
	const kv = memoryKv({ "mail/accounts/v1": v1, "mail/accounts/v2": v2 });
	const originalV1 = Buffer.from(v1);

	const legacyStore = new accountStoreModule.AccountStore(kv as unknown as KVNamespace, oldKey);
	assert.deepEqual(await legacyStore.list(), v1Accounts);

	const secretsStore = new accountStoreModule.AccountStore(
		kv as unknown as KVNamespace,
		secretBinding(newKey) as any,
	);
	assert.deepEqual(await secretsStore.list(), accounts);

	await secretsStore.add({
		name: "Second",
		email: "second@example.com",
		imap: { host: "imap.example.com", port: 993, secure: true },
		auth: { type: "password", password: "second-password" },
	});

	assert.deepEqual(Buffer.from(kv.values.get("mail/accounts/v1")!), originalV1);
	const updatedV2 = kv.values.get("mail/accounts/v2");
	assert.ok(updatedV2);
	const plaintext = await decrypt(updatedV2, newKey);
	assert.equal(JSON.parse(new TextDecoder().decode(plaintext)).length, 2);
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
