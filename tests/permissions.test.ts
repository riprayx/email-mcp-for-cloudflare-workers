import assert from "node:assert/strict";
import test from "node:test";
import { parsePermissionMode, toolAllowed } from "../src/permissions.ts";

const readTools = [
	"email_list_accounts",
	"email_test_connection",
	"email_list_folders",
	"email_get_mailbox_status",
	"email_get_all_account_mailbox_statuses",
	"email_search_messages",
	"email_search_all_accounts",
	"email_list_all_inbox_messages",
	"email_get_message",
	"email_get_message_thread",
	"email_get_message_attachment",
];

const mailOnlyTools = [
	"email_update_message_flags",
	"email_move_messages",
	"email_archive_messages",
	"email_move_messages_to_trash",
	"email_create_message_draft",
	"email_create_forward_draft",
	"email_update_message_draft",
	"email_send_draft",
];

const fullOnlyTools = [
	"email_add_account",
	"email_remove_account",
	"email_delete_messages_permanently",
];

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

test("permission matrix covers all 22 current MCP tools", () => {
	assert.equal(new Set([...readTools, ...mailOnlyTools, ...fullOnlyTools]).size, 22);
	for (const tool of readTools) {
		assert.equal(toolAllowed("read", tool), true, tool);
		assert.equal(toolAllowed("mail", tool), true, tool);
		assert.equal(toolAllowed("full", tool), true, tool);
	}
	for (const tool of mailOnlyTools) {
		assert.equal(toolAllowed("read", tool), false, tool);
		assert.equal(toolAllowed("mail", tool), true, tool);
		assert.equal(toolAllowed("full", tool), true, tool);
	}
	for (const tool of fullOnlyTools) {
		assert.equal(toolAllowed("read", tool), false, tool);
		assert.equal(toolAllowed("mail", tool), false, tool);
		assert.equal(toolAllowed("full", tool), true, tool);
	}
});
