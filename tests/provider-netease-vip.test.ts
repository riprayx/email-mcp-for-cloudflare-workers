import assert from "node:assert/strict";
import test from "node:test";
import { detectProvider, requiresImapClientId } from "../src/mail/providers";

test("detects NetEase VIP mail domains", () => {
	assert.equal(detectProvider("user@vip.163.com")?.imap.host, "imap.vip.163.com");
	assert.equal(detectProvider("user@vip.126.com")?.smtp?.host, "smtp.vip.126.com");
	assert.equal(detectProvider("user@188.com")?.imap.host, "imap.188.com");
	assert.equal(detectProvider("user@vip.188.com")?.smtp?.host, "smtp.vip.188.com");
});

test("NetEase IMAP hosts require RFC 2971 client identification", () => {
	for (const host of [
		"imap.163.com",
		"imap.vip.163.com",
		"imap.126.com",
		"imap.vip.126.com",
		"imap.188.com",
		"imap.vip.188.com",
		"imap.yeah.net",
	]) {
		assert.equal(requiresImapClientId(host), true, host);
	}
	assert.equal(requiresImapClientId("IMAP.163.COM"), true);
	assert.equal(requiresImapClientId("imap.gmail.com"), false);
});
