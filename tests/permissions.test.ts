import assert from "node:assert/strict";
import test from "node:test";
import { parsePermissionMode, toolAllowed } from "../src/permissions";

test("defaults MCP permission mode to mail", () => {
	assert.equal(parsePermissionMode(undefined), "mail");
});

test("rejects invalid MCP permission mode", () => {
	assert.throws(() => parsePermissionMode("admin"), /MCP_PERMISSION_MODE/);
});

test("read mode exposes only read operations", () => {
	assert.equal(toolAllowed("read", "email_get_message"), true);
	assert.equal(toolAllowed("read", "email_send_draft"), false);
	assert.equal(toolAllowed("read", "email_move_messages_to_trash"), false);
});

test("mail mode blocks account administration and permanent deletion", () => {
	assert.equal(toolAllowed("mail", "email_send_draft"), true);
	assert.equal(toolAllowed("mail", "email_remove_account"), false);
	assert.equal(toolAllowed("mail", "email_delete_messages_permanently"), false);
});

test("full mode exposes every known tool", () => {
	assert.equal(toolAllowed("full", "email_add_account"), true);
	assert.equal(toolAllowed("full", "email_delete_messages_permanently"), true);
});

test("unknown tool names fail closed", () => {
	assert.equal(toolAllowed("full", "email_future_unknown_tool"), false);
});
