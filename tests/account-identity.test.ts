import assert from "node:assert/strict";
import test from "node:test";
import { accountUsername, preserveAccountMetadata } from "../src/mail/types";

test("uses explicit login username when provided", () => {
	assert.equal(
		accountUsername({ email: "mailbox@example.com", username: "login-name" }),
		"login-name",
	);
});

test("falls back to mailbox email for existing accounts", () => {
	assert.equal(accountUsername({ email: "mailbox@example.com" }), "mailbox@example.com");
});

test("legacy account updates preserve provider metadata and login username", () => {
	const existing = {
		id: "account-1",
		name: "Before",
		email: "mailbox@example.com",
		provider: "fastmail",
		username: "login-name",
		imap: { host: "imap.fastmail.com", port: 993, secure: true },
		auth: { type: "password" as const, password: "secret" },
	};
	const updated = {
		id: "account-1",
		name: "After",
		email: "mailbox@example.com",
		imap: { host: "imap.fastmail.com", port: 993, secure: true },
		auth: existing.auth,
	};
	assert.deepEqual(preserveAccountMetadata(existing, updated), {
		...updated,
		provider: "fastmail",
		username: "login-name",
	});
});
