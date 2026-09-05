import assert from "node:assert/strict";
import test from "node:test";
import * as providers from "../src/mail/providers.ts";

const { detectProvider, resolveProviderPreset } = providers;
const usesMicrosoftOAuthRefresh = (
	providers as typeof providers & {
		usesMicrosoftOAuthRefresh?: (account: { provider?: string; imap: { host: string } }) => boolean;
	}
).usesMicrosoftOAuthRefresh;

test("detects NetEase 163 from email domain", () => {
	assert.equal(detectProvider("user@163.com")?.id, "netease-163");
});

test("detects QQ mail from domain", () => {
	assert.equal(detectProvider("user@qq.com")?.id, "qq-mail");
});

test("detects Foxmail as QQ Mail", () => {
	assert.equal(detectProvider("user@foxmail.com")?.id, "qq-mail");
});

test("explicit provider preset returns IMAP and SMTP defaults", () => {
	const preset = resolveProviderPreset("netease-163");
	assert.equal(preset?.imap.host, "imap.163.com");
	assert.equal(preset?.smtp?.host, "smtp.163.com");
});

test("includes Fastmail preset", () => {
	assert.equal(resolveProviderPreset("fastmail")?.imap.host, "imap.fastmail.com");
	assert.equal(resolveProviderPreset("fastmail")?.smtp?.host, "smtp.fastmail.com");
});

test("includes Yahoo preset", () => {
	assert.equal(resolveProviderPreset("yahoo")?.imap.host, "imap.mail.yahoo.com");
});

test("includes Zoho preset", () => {
	assert.equal(resolveProviderPreset("zoho")?.smtp?.host, "smtp.zoho.com");
});

test("unknown domains do not invent provider settings", () => {
	assert.equal(detectProvider("user@example.com"), undefined);
});

test("Microsoft OAuth refresh policy is limited to Outlook accounts", () => {
	assert.equal(typeof usesMicrosoftOAuthRefresh, "function");
	assert.equal(
		usesMicrosoftOAuthRefresh?.({ provider: "gmail", imap: { host: "imap.gmail.com" } }),
		false,
	);
	assert.equal(
		usesMicrosoftOAuthRefresh?.({ provider: "outlook", imap: { host: "mail.example.com" } }),
		true,
	);
	assert.equal(
		usesMicrosoftOAuthRefresh?.({ imap: { host: "outlook.office365.com" } }),
		true,
	);
});
