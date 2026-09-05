import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MCP entrypoint is owned by OAuthProvider", async () => {
	const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
	assert.match(source, /OAuthProvider/);
	assert.match(source, /apiRoute:\s*["']\/mcp["']/);
	assert.match(source, /authorizeEndpoint:\s*["']\/authorize["']/);
	assert.match(source, /tokenEndpoint:\s*["']\/token["']/);
	assert.match(source, /clientRegistrationEndpoint:\s*["']\/register["']/);
	assert.doesNotMatch(source, /accessRejection/);
});
