import type { ServerConfig } from "./types";

export interface ProviderPreset {
	id: string;
	name: string;
	domains: string[];
	imap: ServerConfig;
	smtp?: ServerConfig;
	notes: string;
}

export interface AccountSettingsInput {
	email: string;
	provider?: string;
	imap?: Partial<ServerConfig>;
	smtp?: Partial<ServerConfig>;
	smtpEnabled?: boolean;
}

export interface ResolvedAccountSettings {
	provider?: string;
	imap: ServerConfig;
	smtp?: ServerConfig;
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
		id: "netease-vip-163",
		name: "NetEase VIP 163",
		domains: ["vip.163.com"],
		imap: { host: "imap.vip.163.com", port: 993, secure: true },
		smtp: { host: "smtp.vip.163.com", port: 465, secure: true },
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
		id: "netease-vip-126",
		name: "NetEase VIP 126",
		domains: ["vip.126.com"],
		imap: { host: "imap.vip.126.com", port: 993, secure: true },
		smtp: { host: "smtp.vip.126.com", port: 465, secure: true },
		notes: "Use NetEase client authorization code.",
	},
	{
		id: "netease-188",
		name: "NetEase 188",
		domains: ["188.com"],
		imap: { host: "imap.188.com", port: 993, secure: true },
		smtp: { host: "smtp.188.com", port: 465, secure: true },
		notes: "Use NetEase client authorization code.",
	},
	{
		id: "netease-vip-188",
		name: "NetEase VIP 188",
		domains: ["vip.188.com"],
		imap: { host: "imap.vip.188.com", port: 993, secure: true },
		smtp: { host: "smtp.vip.188.com", port: 465, secure: true },
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
		domains: ["qq.com", "foxmail.com"],
		imap: { host: "imap.qq.com", port: 993, secure: true },
		smtp: { host: "smtp.qq.com", port: 465, secure: true },
		notes: "Use a QQ Mail authorization code.",
	},
	{
		id: "fastmail",
		name: "Fastmail",
		domains: ["fastmail.com"],
		imap: { host: "imap.fastmail.com", port: 993, secure: true },
		smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
		notes: "Use a Fastmail app password.",
	},
	{
		id: "yahoo",
		name: "Yahoo Mail",
		domains: ["yahoo.com"],
		imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
		notes: "Use a Yahoo app password.",
	},
	{
		id: "zoho",
		name: "Zoho Mail",
		domains: ["zoho.com"],
		imap: { host: "imap.zoho.com", port: 993, secure: true },
		smtp: { host: "smtp.zoho.com", port: 465, secure: true },
		notes: "Enable IMAP access before connecting.",
	},
];

const NETEASE_IMAP_HOSTS = new Set(
	PROVIDER_PRESETS.filter((provider) => provider.id.startsWith("netease-")).map(
		(provider) => provider.imap.host.toLowerCase(),
	),
);

export function detectProvider(email: string): ProviderPreset | undefined {
	const domain = email.split("@").pop()?.toLowerCase();
	if (!domain) return undefined;
	return PROVIDER_PRESETS.find((provider) => provider.domains.includes(domain));
}

export function resolveProviderPreset(id: string): ProviderPreset | undefined {
	return PROVIDER_PRESETS.find((provider) => provider.id === id);
}

export function requiresImapClientId(host: string): boolean {
	return NETEASE_IMAP_HOSTS.has(host.trim().toLowerCase());
}

export function usesMicrosoftOAuthRefresh(account: {
	provider?: string;
	imap: { host: string };
}): boolean {
	return (
		account.provider?.trim().toLowerCase() === "outlook" ||
		account.imap.host.trim().toLowerCase() === "outlook.office365.com"
	);
}

export function resolveAccountSettings(input: AccountSettingsInput): ResolvedAccountSettings {
	const providerId = input.provider?.trim().toLowerCase();
	const explicit = providerId ? resolveProviderPreset(providerId) : undefined;
	if (providerId && providerId !== "custom" && !explicit)
		throw new Error(`Unknown email provider: ${providerId}`);
	const preset = providerId === "custom" ? undefined : explicit ?? detectProvider(input.email);

	const imapHost = input.imap?.host ?? preset?.imap.host;
	if (!imapHost) throw new Error("IMAP host is required for custom email providers");
	const imap: ServerConfig = {
		host: validHost(imapHost, "IMAP host"),
		port: validPort(input.imap?.port ?? preset?.imap.port ?? 993, "IMAP port"),
		secure: input.imap?.secure ?? preset?.imap.secure ?? true,
	};

	if (input.smtpEnabled === false) return { provider: preset?.id, imap };
	const smtpHost = input.smtp?.host ?? preset?.smtp?.host;
	if (!smtpHost) {
		if (input.smtp?.port !== undefined || input.smtp?.secure !== undefined)
			throw new Error("SMTP host is required when SMTP settings are provided");
		return { provider: preset?.id, imap };
	}

	return {
		provider: preset?.id,
		imap,
		smtp: {
			host: validHost(smtpHost, "SMTP host"),
			port: validPort(input.smtp?.port ?? preset?.smtp?.port ?? 465, "SMTP port"),
			secure: input.smtp?.secure ?? preset?.smtp?.secure ?? true,
		},
	};
}

function validPort(port: number, label: string): number {
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new Error(`${label} must be between 1 and 65535`);
	return port;
}

function validHost(value: string, label: string): string {
	const host = value.trim();
	if (
		host.length > 253 ||
		!/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(
			host,
		)
	)
		throw new Error(`${label} is invalid`);
	return host;
}
