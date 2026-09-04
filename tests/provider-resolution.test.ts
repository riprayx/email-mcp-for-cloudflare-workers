import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccountSettings } from "../src/mail/providers.ts";

test("fills known provider defaults from email domain", () => {
	assert.deepEqual(resolveAccountSettings({ email: "user@163.com" }), {
		provider: "netease-163",
		imap: { host: "imap.163.com", port: 993, secure: true },
		smtp: { host: "smtp.163.com", port: 465, secure: true },
	});
});

test("explicit server settings override provider defaults", () => {
	const resolved = resolveAccountSettings({
		email: "user@163.com",
		imap: { host: "mail.example.com" },
		smtp: { port: 587, secure: false },
	});
	assert.deepEqual(resolved.imap, { host: "mail.example.com", port: 993, secure: true });
	assert.deepEqual(resolved.smtp, { host: "smtp.163.com", port: 587, secure: false });
});

test("explicit custom provider disables domain autodetection", () => {
	const resolved = resolveAccountSettings({
		email: "user@163.com",
		provider: "custom",
		imap: { host: "imap.example.com", port: 1993, secure: false },
		smtp: { host: "smtp.example.com", port: 1587, secure: false },
	});
	assert.equal(resolved.provider, undefined);
	assert.deepEqual(resolved.imap, { host: "imap.example.com", port: 1993, secure: false });
	assert.deepEqual(resolved.smtp, { host: "smtp.example.com", port: 1587, secure: false });
});

test("smtp can be disabled even when provider has a default", () => {
	assert.equal(resolveAccountSettings({ email: "user@163.com", smtpEnabled: false }).smtp, undefined);
});

test("unknown provider requires explicit IMAP host", () => {
	assert.throws(() => resolveAccountSettings({ email: "user@example.com" }), /IMAP host/);
});

test("rejects invalid custom hosts and ports", () => {
	assert.throws(
		() => resolveAccountSettings({ email: "user@example.com", provider: "custom", imap: { host: "bad host" } }),
		/IMAP host/,
	);
	assert.throws(
		() => resolveAccountSettings({ email: "user@example.com", provider: "custom", imap: { host: "imap.example.com", port: 0 } }),
		/IMAP port/,
	);
	assert.throws(
		() => resolveAccountSettings({
			email: "user@example.com",
			provider: "custom",
			imap: { host: "imap.example.com" },
			smtp: { host: "smtp.example.com", port: 70_000 },
		}),
		/SMTP port/,
	);
});
