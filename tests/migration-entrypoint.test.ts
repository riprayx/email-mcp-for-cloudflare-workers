import assert from "node:assert/strict";
import test from "node:test";
import { runCredentialMigration } from "../src/migration.ts";

function memoryKv() {
	const values = new Map<string, string>();
	return {
		values,
		async put(key: string, value: string) {
			values.set(key, value);
		},
	};
}

test("credential migration writes only a safe verified status marker", async () => {
	const kv = memoryKv();
	const oldKey = "legacy-key";
	const newKey = { get: async () => "next-key" };
	const calls: unknown[][] = [];
	const result = await runCredentialMigration(
		{
			EMAIL_KV: kv as unknown as KVNamespace,
			CREDENTIAL_ENCRYPTION_KEY: oldKey,
			NEXT_CREDENTIAL_ENCRYPTION_KEY: newKey,
		},
		{
			migrate: async (...args: unknown[]) => {
				calls.push(args);
				return { count: 3, verified: true };
			},
			now: () => 1_800_000_000_000,
		},
	);

	assert.deepEqual(result, { count: 3, verified: true });
	assert.deepEqual(calls, [[kv, oldKey, newKey]]);
	const marker = JSON.parse(kv.values.get("mail/migrations/credential-v2") ?? "null");
	assert.deepEqual(marker, {
		completedAt: "2027-01-15T08:00:00.000Z",
		count: 3,
		verified: true,
	});
	assert.deepEqual(Object.keys(marker).sort(), ["completedAt", "count", "verified"]);
});

test("credential migration never writes a success marker after failure", async () => {
	const kv = memoryKv();
	await assert.rejects(
		() =>
			runCredentialMigration(
				{
					EMAIL_KV: kv as unknown as KVNamespace,
					CREDENTIAL_ENCRYPTION_KEY: "legacy-key",
					NEXT_CREDENTIAL_ENCRYPTION_KEY: { get: async () => "next-key" },
				},
				{
					migrate: async () => {
						throw new Error("migration failed");
					},
					now: () => 1_800_000_000_000,
				},
			),
		/migration failed/,
	);
	assert.equal(kv.values.has("mail/migrations/credential-v2"), false);
});
