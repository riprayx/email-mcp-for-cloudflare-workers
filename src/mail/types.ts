export interface MailEnv extends Cloudflare.Env {
	MCP_PERMISSION_MODE?: string;
}

export interface ServerConfig {
	host: string;
	port: number;
	secure: boolean;
}

export type AccountAuth =
	| { type: "password"; password: string }
	| {
			type: "oauth2";
			accessToken: string;
			refreshToken?: string;
			clientId?: string;
			tenant?: string;
			expiresAt?: number;
	  };

export interface MailAccount {
	id: string;
	name: string;
	email: string;
	provider?: string;
	username?: string;
	imap: ServerConfig;
	smtp?: ServerConfig;
	auth: AccountAuth;
}

export function accountUsername(account: Pick<MailAccount, "email" | "username">): string {
	return account.username?.trim() || account.email;
}

export function preserveAccountMetadata(existing: MailAccount, updated: MailAccount): MailAccount {
	return {
		...updated,
		provider: updated.provider ?? existing.provider,
		username: updated.username ?? existing.username,
	};
}
