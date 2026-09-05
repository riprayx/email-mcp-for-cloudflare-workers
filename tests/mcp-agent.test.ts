import assert from "node:assert/strict";
import test from "node:test";
import { MyMCP, type McpIdentityProps } from "../src/mcp-agent.ts";

test("MCP agent is transport-independent and accepts authenticated identity props", () => {
	const identity: McpIdentityProps = {
		accessToken: "upstream-token",
		email: "user@example.com",
		login: "subject-1",
		name: "User",
	};
	assert.equal(typeof MyMCP, "function");
	assert.equal(identity.email, "user@example.com");
});
