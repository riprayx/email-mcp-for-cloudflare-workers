import assert from "node:assert/strict";
import test from "node:test";
import { detectProvider } from "../src/mail/providers";

test("detects NetEase VIP mail domains", () => {
	assert.equal(detectProvider("user@vip.163.com")?.imap.host, "imap.vip.163.com");
	assert.equal(detectProvider("user@vip.126.com")?.smtp?.host, "smtp.vip.126.com");
	assert.equal(detectProvider("user@188.com")?.imap.host, "imap.188.com");
	assert.equal(detectProvider("user@vip.188.com")?.smtp?.host, "smtp.vip.188.com");
});
