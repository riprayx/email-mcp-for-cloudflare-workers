import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessJwtEnv {
	TEAM_DOMAIN: string;
	POLICY_AUD: string;
}

export interface AccessIdentity {
	email: string;
	sub: string;
}

export function validateAccessJwtEnvironment(env: AccessJwtEnv): string {
	const teamDomain = env.TEAM_DOMAIN.replace(/\/$/, "");
	if (!teamDomain.startsWith("https://") || !env.POLICY_AUD)
		throw new Error("Cloudflare Access is not configured");
	return teamDomain;
}

let cachedTeamDomain: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function verifyAccessJwt(
	token: string,
	env: AccessJwtEnv,
): Promise<AccessIdentity> {
	const teamDomain = validateAccessJwtEnvironment(env);
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
