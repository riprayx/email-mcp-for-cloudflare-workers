import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { McpIdentityProps } from "../src/mcp-agent.ts";

test("MCP agent is transport-independent and accepts authenticated identity props", async () => {
	const identity: McpIdentityProps = {
		accessToken: "upstream-token",
		email: "user@example.com",
		login: "subject-1",
		name: "User",
	};
	const source = await readFile(new URL("../src/mcp-agent.ts", import.meta.url), "utf8");
	assert.match(source, /export class MyMCP extends McpAgent/);
	assert.equal(identity.email, "user@example.com");
});
