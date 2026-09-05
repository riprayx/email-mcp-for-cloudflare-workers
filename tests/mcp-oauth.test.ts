import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedIdentity } from "../src/oauth/access-handler.ts";

test("only the configured Access identity can complete MCP authorization", () => {
	assert.doesNotThrow(() =>
		assertApprovedIdentity("owner@example.com", "owner@example.com"),
	);
	assert.throws(
		() => assertApprovedIdentity("other@example.com", "owner@example.com"),
		/not authorized/i,
	);
});
