import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedIdentity } from "../src/oauth/access-handler.ts";

test("only the configured Access identity can complete MCP authorization", () => {
	assert.doesNotThrow(() =>
		assertApprovedIdentity("riprayx@gmail.com", "riprayx@gmail.com"),
	);
	assert.throws(
		() => assertApprovedIdentity("other@example.com", "riprayx@gmail.com"),
		/not authorized/i,
	);
});
