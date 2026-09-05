import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin Worker keeps Access verification and never exposes MCP", async () => {
	const source = await readFile(new URL("../src/admin.ts", import.meta.url), "utf8");
	assert.match(source, /accessRejection/);
	assert.match(source, /verifyAccessJwt/);
	assert.match(source, /pathname\s*===\s*["']\/mcp["']/);
	assert.match(source, /pathname\.startsWith\(["']\/mcp\/["']\)/);
	assert.match(source, /status:\s*404/);
	assert.match(source, /app\.fetch/);
});
