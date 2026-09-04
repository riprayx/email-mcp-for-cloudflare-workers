import type { ServerConfig } from "./types";

export interface ProviderPreset {
	id: string;
	name: string;
	domains: string[];
	imap: ServerConfig;
	smtp?: ServerConfig;
	notes: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		id: "gmail",
		name: "Gmail",
		domains: ["gmail.com", "googlemail.com"],
		imap: { host: "imap.gmail.com", port: 993, secure: true },
		smtp: { host: "smtp.gmail.com", port: 465, secure: true },
		notes: "Use an app password or OAuth2.",
	},
	{
		id: "outlook",
		name: "Outlook / Microsoft",
		domains: ["outlook.com", "hotmail.com", "live.com"],
		imap: { host: "outlook.office365.com", port: 993, secure: true },
		smtp: { host: "smtp.office365.com", port: 587, secure: false },
		notes: "OAuth2 is preferred.",
	},
	{
		id: "icloud",
		name: "iCloud Mail",
		domains: ["icloud.com", "me.com", "mac.com"],
		imap: { host: "imap.mail.me.com", port: 993, secure: true },
		smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
		notes: "Use an app-specific password.",
	},
	{
		id: "netease-163",
		name: "NetEase 163",
		domains: ["163.com"],
		imap: { host: "imap.163.com", port: 993, secure: true },
		smtp: { host: "smtp.163.com", port: 465, secure: true },
		notes: "Use NetEase client authorization code.",
	},
	{
		id: "netease-126",
		name: "NetEase 126",
		domains: ["126.com"],
		imap: { host: "imap.126.com", port: 993, secure: true },
		smtp: { host: "smtp.126.com", port: 465, secure: true },
		notes: "Use NetEase client authorization code.",
	},
	{
		id: "netease-yeah",
		name: "NetEase Yeah",
		domains: ["yeah.net"],
		imap: { host: "imap.yeah.net", port: 993, secure: true },
		smtp: { host: "smtp.yeah.net", port: 465, secure: true },
		notes: "Use NetEase client authorization code.",
	},
	{
		id: "qq-mail",
		name: "QQ Mail",
		domains: ["qq.com"],
		imap: { host: "imap.qq.com", port: 993, secure: true },
		smtp: { host: "smtp.qq.com", port: 465, secure: true },
		notes: "Use QQ mailbox authorization code.",
	},
];

export function detectProvider(email: string): ProviderPreset | undefined {
	const domain = email.split("@").pop()?.toLowerCase();
	if (!domain) return undefined;
	return PROVIDER_PRESETS.find((provider) => provider.domains.includes(domain));
}

export function resolveProviderPreset(id: string): ProviderPreset | undefined {
	return PROVIDER_PRESETS.find((provider) => provider.id === id);
}
