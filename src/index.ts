import { createRemoteJWKSet, jwtVerify } from "jose";
import { accessRejection } from "./access";
import app from "./app";
import type { MailEnv } from "./mail/types";
import { MyMCP } from "./mcp-agent";

export { MyMCP } from "./mcp-agent";

interface AccessIdentity {
	email: string;
	sub: string;
}

let cachedTeamDomain: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifyAccessJwt(token: string, env: MailEnv): Promise<AccessIdentity> {
	const teamDomain = env.TEAM_DOMAIN.replace(/\/$/, "");
	if (!teamDomain.startsWith("https://") || !env.POLICY_AUD)
		throw new Error("Cloudflare Access is not configured");
	if (!cachedJwks || cachedTeamDomain !== teamDomain) {
		cachedTeamDomain = teamDomain;
		cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
	}
	const { payload } = await jwtVerify(token, cachedJwks, {
		issuer: teamDomain,
		audience: env.POLICY_AUD,
	});
	if (typeof payload.email !== "string" || typeof payload.sub !== "string")
		throw new Error("Cloudflare Access token is missing identity claims");
	return { email: payload.email, sub: payload.sub };
}

const mcpHandler = MyMCP.serve("/mcp");

export default {
	async fetch(request: Request, env: MailEnv, ctx: ExecutionContext): Promise<Response> {
		const rejection = await accessRejection(request, env, (token) =>
			verifyAccessJwt(token, env),
		);
		if (rejection) return rejection;

		const pathname = new URL(request.url).pathname;
		return pathname === "/mcp" || pathname.startsWith("/mcp/")
			? mcpHandler.fetch(request, env, ctx)
			: app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<MailEnv>;
