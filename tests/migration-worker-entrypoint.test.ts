import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration entrypoint composes legacy HTTP handlers with scheduled migration", async () => {
	const source = await readFile(new URL("../src/migrate-entry.ts", import.meta.url), "utf8");
	assert.match(source, /createMigrationHandler/);
	assert.match(source, /verifyAccessJwt/);
	assert.match(source, /MyMCP\.serve\(["']\/mcp["']\)/);
	assert.match(source, /runCredentialMigration/);
	assert.match(source, /app/);
	assert.match(source, /export\s+\{\s*MyMCP\s*\}/);
	assert.match(source, /export\s+default/);
});
