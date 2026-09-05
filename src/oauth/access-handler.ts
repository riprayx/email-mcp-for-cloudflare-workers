import type {
	AuthorizationError,
	AuthRequest,
	OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeErrorCategory } from "../observability.ts";
import type { McpIdentityProps } from "../mcp-agent.ts";
import {
	addApprovedClient,
	createOAuthState,
	decodeApprovalState,
	fetchUpstreamAuthToken,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils.ts";

export interface McpOAuthEnv extends Cloudflare.Env {
	OAUTH_KV: KVNamespace;
	OAUTH_PROVIDER: OAuthHelpers;
	ACCESS_CLIENT_ID: string;
	ACCESS_AUTHORIZATION_URL: string;
	ACCESS_TOKEN_URL: string;
	ACCESS_JWKS_URL: string;
	COOKIE_ENCRYPTION_KEY: string;
	ALLOWED_EMAIL: string;
}

interface AccessOidcClaims {
	email: string;
	name: string;
	sub: string;
}

let cachedJwksUrl: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export function assertApprovedIdentity(email: string, allowedEmail: string): void {
	const normalizedEmail = email.trim().toLowerCase();
	const normalizedAllowed = allowedEmail.trim().toLowerCase();
	if (!normalizedEmail || !normalizedAllowed || normalizedEmail !== normalizedAllowed) {
		throw new OAuthError("access_denied", "Authenticated identity is not authorized", 403);
	}
}

export async function handleAccessRequest(
	request: Request,
	env: McpOAuthEnv,
	_ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	try {
		if (request.method === "GET" && url.pathname === "/authorize") {
			return handleAuthorizeGet(request, env);
		}
		if (request.method === "POST" && url.pathname === "/authorize") {
			return handleAuthorizePost(request, env);
		}
		if (request.method === "GET" && url.pathname === "/callback") {
			return handleCallback(request, env);
		}
		return new Response("Not Found", { status: 404 });
	} catch (error) {
		if (error instanceof OAuthError) return error.toResponse();
		if (isAuthorizationError(error)) return authorizationErrorResponse(error);
		console.error({
			event: "mcp_oauth_error",
			path: url.pathname,
			error: safeErrorCategory(error),
		});
		return new Response("Internal server error", { status: 500 });
	}
}

async function handleAuthorizeGet(request: Request, env: McpOAuthEnv): Promise<Response> {
	const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
	const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
	if (!client) throw new OAuthError("invalid_request", "Unknown OAuth client");

	if (await isClientApproved(request, oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY)) {
		return beginUpstreamAuthorization(request, env, oauthReqInfo);
	}

	const { token, setCookie } = generateCSRFProtection();
	return renderApprovalDialog(request, {
		client,
		csrfToken: token,
		server: {
			name: "Universal Email MCP",
			description: "Authorize this MCP client to use your configured email tools.",
		},
		setCookie,
		state: { oauthReqInfo },
	});
}

async function handleAuthorizePost(request: Request, env: McpOAuthEnv): Promise<Response> {
	const formData = await request.formData();
	const { clearCookie } = validateCSRFToken(formData, request);
	const state = decodeApprovalState(formData.get("state"));
	const oauthReqInfo = state.oauthReqInfo as AuthRequest | undefined;
	if (!oauthReqInfo?.clientId) throw new OAuthError("invalid_request", "Invalid approval state");
	const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
	if (!client) throw new OAuthError("invalid_request", "Unknown OAuth client");

	const approvedClientCookie = await addApprovedClient(
		request,
		oauthReqInfo.clientId,
		env.COOKIE_ENCRYPTION_KEY,
	);
	const headers = new Headers();
	headers.append("Set-Cookie", approvedClientCookie);
	headers.append("Set-Cookie", clearCookie);
	return beginUpstreamAuthorization(request, env, oauthReqInfo, headers);
}

async function beginUpstreamAuthorization(
	request: Request,
	env: McpOAuthEnv,
	oauthReqInfo: AuthRequest,
	headers = new Headers(),
): Promise<Response> {
	const { stateToken, codeChallenge } = await createOAuthState(
		oauthReqInfo,
		env.OAUTH_KV,
		env.COOKIE_ENCRYPTION_KEY,
	);
	const callbackUrl = new URL("/callback", request.url).href;
	headers.set(
		"Location",
		getUpstreamAuthorizeUrl({
			client_id: env.ACCESS_CLIENT_ID,
			code_challenge: codeChallenge,
			redirect_uri: callbackUrl,
			scope: "openid email profile",
			state: stateToken,
			upstream_url: env.ACCESS_AUTHORIZATION_URL,
		}),
	);
	return new Response(null, { status: 302, headers });
}

async function handleCallback(request: Request, env: McpOAuthEnv): Promise<Response> {
	const { oauthReqInfo, codeVerifier } = await validateOAuthState(
		request,
		env.OAUTH_KV,
		env.COOKIE_ENCRYPTION_KEY,
	);
	const code = new URL(request.url).searchParams.get("code") ?? undefined;
	const upstream = await fetchUpstreamAuthToken({
		client_id: env.ACCESS_CLIENT_ID,
		code,
		redirect_uri: new URL("/callback", request.url).href,
		upstream_url: env.ACCESS_TOKEN_URL,
		code_verifier: codeVerifier,
	});
	const claims = await verifyAccessIdToken(upstream.idToken, env);
	assertApprovedIdentity(claims.email, env.ALLOWED_EMAIL);

	const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
	if (!client) throw new OAuthError("invalid_request", "Unknown OAuth client");
	const props: McpIdentityProps = {
		accessToken: upstream.accessToken,
		email: claims.email,
		login: claims.sub,
		name: claims.name,
	};
	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: claims.sub,
		metadata: { clientName: client.clientName },
		scope: oauthReqInfo.scope,
		props,
	});
	return Response.redirect(redirectTo, 302);
}

async function verifyAccessIdToken(
	idToken: string,
	env: Pick<McpOAuthEnv, "ACCESS_JWKS_URL" | "ACCESS_AUTHORIZATION_URL" | "ACCESS_CLIENT_ID">,
): Promise<AccessOidcClaims> {
	if (!env.ACCESS_JWKS_URL.startsWith("https://"))
		throw new OAuthError("server_error", "Access JWKS endpoint is not configured", 500);
	if (!cachedJwks || cachedJwksUrl !== env.ACCESS_JWKS_URL) {
		cachedJwksUrl = env.ACCESS_JWKS_URL;
		cachedJwks = createRemoteJWKSet(new URL(env.ACCESS_JWKS_URL));
	}
	const issuer = env.ACCESS_AUTHORIZATION_URL.replace(/\/authorization\/?$/, "");
	const { payload } = await jwtVerify(idToken, cachedJwks, {
		issuer,
		audience: env.ACCESS_CLIENT_ID,
	});
	if (
		typeof payload.email !== "string" ||
		typeof payload.sub !== "string" ||
		!payload.email ||
		!payload.sub
	) {
		throw new OAuthError(
			"access_denied",
			"Access identity token is missing required claims",
			403,
		);
	}
	return {
		email: payload.email,
		sub: payload.sub,
		name: typeof payload.name === "string" && payload.name ? payload.name : payload.email,
	};
}

function isAuthorizationError(error: unknown): error is AuthorizationError {
	if (!error || typeof error !== "object") return false;
	const candidate = error as Partial<AuthorizationError>;
	return (
		typeof candidate.code === "string" &&
		typeof candidate.description === "string" &&
		"redirectUri" in candidate
	);
}

function authorizationErrorResponse(error: AuthorizationError): Response {
	if (!error.redirectUri) return new Response(error.description, { status: 400 });
	const redirect = new URL(error.redirectUri);
	redirect.searchParams.set("error", error.code);
	redirect.searchParams.set("error_description", error.description);
	if (error.state) redirect.searchParams.set("state", error.state);
	if (error.issuer) redirect.searchParams.set("iss", error.issuer);
	return Response.redirect(redirect.href, 302);
}
