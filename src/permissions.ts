export type McpPermissionMode = "read" | "mail" | "full";

const READ_TOOLS = new Set([
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
]);

const MAIL_TOOLS = new Set([
	...READ_TOOLS,
	"email_update_message_flags",
	"email_move_messages",
	"email_archive_messages",
	"email_move_messages_to_trash",
	"email_create_message_draft",
	"email_create_forward_draft",
	"email_update_message_draft",
	"email_send_draft",
]);

const FULL_TOOLS = new Set([
	...MAIL_TOOLS,
	"email_add_account",
	"email_remove_account",
	"email_delete_messages_permanently",
]);

export function parsePermissionMode(value?: string): McpPermissionMode {
	const mode = (value?.trim().toLowerCase() || "mail") as McpPermissionMode;
	if (mode !== "read" && mode !== "mail" && mode !== "full")
		throw new Error("MCP_PERMISSION_MODE must be read, mail, or full");
	return mode;
}

export function toolAllowed(mode: McpPermissionMode, toolName: string): boolean {
	return (mode === "read" ? READ_TOOLS : mode === "mail" ? MAIL_TOOLS : FULL_TOOLS).has(toolName);
}
