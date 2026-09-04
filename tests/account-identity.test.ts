import assert from "node:assert/strict";
import test from "node:test";
import { accountUsername } from "../src/mail/types";

test("uses explicit login username when provided", () => {
	assert.equal(
		accountUsername({ email: "mailbox@example.com", username: "login-name" }),
		"login-name",
	);
});

test("falls back to mailbox email for existing accounts", () => {
	assert.equal(accountUsername({ email: "mailbox@example.com" }), "mailbox@example.com");
});
