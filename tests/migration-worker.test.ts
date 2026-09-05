import assert from "node:assert/strict";
import test from "node:test";
import { createMigrationHandler } from "../src/migrate.ts";

function responseHandler(body: string) {
	return {
		async fetch() {
			return new Response(body);
		},
	};
}

test("migration Worker preserves Access and existing HTTP routing", async () => {
	const handler = createMigrationHandler({
		verify: async () => ({ email: "owner@example.com", sub: "owner" }),
		mcp: responseHandler("mcp"),
		admin: responseHandler("admin"),
		migrate: async () => ({ count: 1, verified: true }),
	});
	const env = { ACCESS_LOCAL_DEV: "false" } as any;
	const ctx = {} as ExecutionContext;

	const unauthorized = await handler.fetch(new Request("https://worker.example/"), env, ctx);
	assert.equal(unauthorized.status, 401);

	const headers = { "Cf-Access-Jwt-Assertion": "valid" };
	const mcp = await handler.fetch(new Request("https://worker.example/mcp", { headers }), env, ctx);
	assert.equal(await mcp.text(), "mcp");

	const admin = await handler.fetch(new Request("https://worker.example/", { headers }), env, ctx);
	assert.equal(await admin.text(), "admin");
});

test("migration Worker schedules one non-blocking credential migration", async () => {
	let migrations = 0;
	const handler = createMigrationHandler({
		verify: async () => ({}),
		mcp: responseHandler("mcp"),
		admin: responseHandler("admin"),
		migrate: async () => {
			migrations += 1;
			return { count: 2, verified: true };
		},
	});
	const promises: Promise<unknown>[] = [];
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			promises.push(promise);
		},
	} as unknown as ExecutionContext;

	handler.scheduled?.({} as ScheduledController, {} as any, ctx);
	assert.equal(promises.length, 1);
	await promises[0];
	assert.equal(migrations, 1);
});
