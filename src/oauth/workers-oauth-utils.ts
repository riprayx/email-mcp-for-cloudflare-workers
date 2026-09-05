import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

export class OAuthError extends Error {
	readonly code: string;
	readonly description: string;
	readonly statusCode: number;

	constructor(code: string, description: string, statusCode = 400) {
		super(description);
		this.name = "OAuthError";
		this.code = code;
		this.description = description;
		this.statusCode = statusCode;
	}

	toResponse(): Response {
		return Response.json(
			{ error: this.code, error_description: this.description },
			{ status: this.statusCode },
		);
	}
}

export interface OAuthStateResult {
	stateToken: string;
	codeChallenge: string;
}

export interface ValidateStateResult {
	oauthReqInfo: AuthRequest;
	codeVerifier: string;
}

export interface CSRFProtectionResult {
	token: string;
	setCookie: string;
}

export interface ValidateCSRFResult {
	clearCookie: string;
}

export interface UpstreamTokenResult {
	accessToken: string;
	idToken: string;
}

export function sanitizeText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export function sanitizeUrl(value: string): string {
	const normalized = value.trim();
	if (!normalized) return "";
	for (let index = 0; index < normalized.length; index++) {
		const code = normalized.charCodeAt(index);
		if ((code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return "";
	}
	try {
		const url = new URL(normalized);
		return url.protocol === "https:" || url.protocol === "http:" ? normalized : "";
	} catch {
		return "";
	}
}

export function generateCSRFProtection(): CSRFProtectionResult {
	const token = crypto.randomUUID();
	return {
		token,
		setCookie: `__Host-CSRF_TOKEN=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`,
	};
}

export function validateCSRFToken(formData: FormData, request: Request): ValidateCSRFResult {
	const tokenFromForm = formData.get("csrf_token");
	if (!tokenFromForm || typeof tokenFromForm !== "string")
		throw new OAuthError("invalid_request", "Missing CSRF token in form data");
	const tokenFromCookie = cookieValue(request, "__Host-CSRF_TOKEN");
	if (!tokenFromCookie) throw new OAuthError("invalid_request", "Missing CSRF token cookie");
	if (tokenFromForm !== tokenFromCookie)
		throw new OAuthError("invalid_request", "CSRF token mismatch");
	return {
		clearCookie: "__Host-CSRF_TOKEN=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0",
	};
}

export async function createOAuthState(
	oauthReqInfo: AuthRequest,
	kv: KVNamespace,
	secret: string,
	stateTTL = 600,
): Promise<OAuthStateResult> {
	const uuid = crypto.randomUUID();
	const { codeVerifier, codeChallenge } = await generatePKCE();
	const hmac = await signData(uuid, secret);
	const stateToken = `${uuid}.${hmac}`;
	await kv.put(`oauth:state:${uuid}`, JSON.stringify({ oauthReqInfo, codeVerifier }), {
		expirationTtl: stateTTL,
	});
	return { stateToken, codeChallenge };
}

export async function validateOAuthState(
	request: Request,
	kv: KVNamespace,
	secret: string,
): Promise<ValidateStateResult> {
	const state = new URL(request.url).searchParams.get("state");
	if (!state) throw new OAuthError("invalid_request", "Missing state parameter");
	const separator = state.lastIndexOf(".");
	if (separator <= 0 || separator === state.length - 1)
		throw new OAuthError("invalid_request", "Invalid state format");
	const uuid = state.slice(0, separator);
	const signature = state.slice(separator + 1);
	if (!(await verifySignature(signature, uuid, secret)))
		throw new OAuthError("invalid_request", "Invalid state signature");
	const encoded = await kv.get(`oauth:state:${uuid}`);
	if (!encoded) throw new OAuthError("invalid_request", "Invalid or expired state");
	await kv.delete(`oauth:state:${uuid}`);
	try {
		const stored = JSON.parse(encoded) as Partial<ValidateStateResult>;
		if (!stored.oauthReqInfo || typeof stored.codeVerifier !== "string" || !stored.codeVerifier)
			throw new Error("invalid state data");
		return {
			oauthReqInfo: stored.oauthReqInfo,
			codeVerifier: stored.codeVerifier,
		};
	} catch (error) {
		if (error instanceof OAuthError) throw error;
		throw new OAuthError("server_error", "Invalid state data", 500);
	}
}

export async function isClientApproved(
	request: Request,
	clientId: string,
	cookieSecret: string,
): Promise<boolean> {
	const clients = await approvedClients(request, cookieSecret);
	return clients?.includes(clientId) ?? false;
}

export async function addApprovedClient(
	request: Request,
	clientId: string,
	cookieSecret: string,
): Promise<string> {
	const clients = (await approvedClients(request, cookieSecret)) ?? [];
	const payload = JSON.stringify(Array.from(new Set([...clients, clientId])));
	const signature = await signData(payload, cookieSecret);
	const encoded = bytesToBase64Url(new TextEncoder().encode(payload));
	return `__Host-APPROVED_CLIENTS=${signature}.${encoded}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`;
}

export function renderApprovalDialog(
	request: Request,
	options: {
		client: ClientInfo | null;
		server: { name: string; description?: string };
		state: Record<string, unknown>;
		csrfToken: string;
		setCookie: string;
	},
): Response {
	const clientName = sanitizeText(options.client?.clientName || "Unknown MCP Client");
	const serverName = sanitizeText(options.server.name);
	const description = options.server.description
		? `<p>${sanitizeText(options.server.description)}</p>`
		: "";
	const encodedState = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(options.state)));
	const action = sanitizeText(new URL(request.url).pathname);
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${serverName}</title></head>
<body><main><h1>Authorize ${serverName}</h1>${description}<p><strong>${clientName}</strong> is requesting access.</p>
<form method="post" action="${action}"><input type="hidden" name="state" value="${encodedState}"><input type="hidden" name="csrf_token" value="${sanitizeText(options.csrfToken)}"><button type="submit">Approve</button></form></main></body></html>`;
	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy":
				"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "no-referrer",
			"Set-Cookie": options.setCookie,
		},
	});
}

export function decodeApprovalState(value: FormDataEntryValue | null): Record<string, unknown> {
	if (typeof value !== "string" || !value)
		throw new OAuthError("invalid_request", "Missing approval state");
	try {
		const decoded = new TextDecoder().decode(base64UrlToBytes(value));
		const parsed = JSON.parse(decoded);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
		return parsed as Record<string, unknown>;
	} catch {
		throw new OAuthError("invalid_request", "Invalid approval state");
	}
}

export function getUpstreamAuthorizeUrl(params: {
	upstream_url: string;
	client_id: string;
	redirect_uri: string;
	scope: string;
	state: string;
	code_challenge: string;
	code_challenge_method?: string;
}): string {
	const url = new URL(params.upstream_url);
	url.searchParams.set("client_id", params.client_id);
	url.searchParams.set("redirect_uri", params.redirect_uri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", params.scope);
	url.searchParams.set("state", params.state);
	url.searchParams.set("code_challenge", params.code_challenge);
	url.searchParams.set("code_challenge_method", params.code_challenge_method ?? "S256");
	return url.toString();
}

export async function fetchUpstreamAuthToken(params: {
	upstream_url: string;
	client_id: string;
	client_secret?: string;
	code?: string;
	redirect_uri: string;
	code_verifier: string;
}): Promise<UpstreamTokenResult> {
	if (!params.code) throw new OAuthError("invalid_request", "Missing authorization code");
	const body = new URLSearchParams({
		client_id: params.client_id,
		code: params.code,
		grant_type: "authorization_code",
		redirect_uri: params.redirect_uri,
		code_verifier: params.code_verifier,
	});
	if (params.client_secret) body.set("client_secret", params.client_secret);
	const response = await fetch(params.upstream_url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!response.ok)
		throw new OAuthError("server_error", "Upstream authorization code exchange failed", 502);
	let responseBody: unknown;
	try {
		responseBody = await response.json();
	} catch {
		throw new OAuthError("server_error", "Upstream token response was invalid", 502);
	}
	const token = responseBody as { access_token?: unknown; id_token?: unknown };
	if (typeof token.access_token !== "string" || typeof token.id_token !== "string")
		throw new OAuthError("server_error", "Upstream token response was incomplete", 502);
	return { accessToken: token.access_token, idToken: token.id_token };
}

async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
	const codeVerifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
	return { codeVerifier, codeChallenge: bytesToBase64Url(new Uint8Array(digest)) };
}

async function approvedClients(request: Request, secret: string): Promise<string[] | null> {
	const value = cookieValue(request, "__Host-APPROVED_CLIENTS");
	if (!value) return null;
	const separator = value.indexOf(".");
	if (separator <= 0 || separator === value.length - 1) return null;
	const signature = value.slice(0, separator);
	let payload: string;
	try {
		payload = new TextDecoder().decode(base64UrlToBytes(value.slice(separator + 1)));
	} catch {
		return null;
	}
	if (!(await verifySignature(signature, payload, secret))) return null;
	try {
		const parsed = JSON.parse(payload);
		return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
			? parsed
			: null;
	} catch {
		return null;
	}
}

function cookieValue(request: Request, name: string): string | null {
	const prefix = `${name}=`;
	for (const part of (request.headers.get("Cookie") || "").split(";")) {
		const cookie = part.trim();
		if (cookie.startsWith(prefix)) return cookie.slice(prefix.length);
	}
	return null;
}

async function signData(data: string, secret: string): Promise<string> {
	const signature = await crypto.subtle.sign(
		"HMAC",
		await hmacKey(secret),
		new TextEncoder().encode(data),
	);
	return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySignature(signature: string, data: string, secret: string): Promise<boolean> {
	try {
		return await crypto.subtle.verify(
			"HMAC",
			await hmacKey(secret),
			base64UrlToBytes(signature),
			new TextEncoder().encode(data),
		);
	} catch {
		return false;
	}
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("OAuth cookie/state secret is required");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
