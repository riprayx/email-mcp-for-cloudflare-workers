import assert from "node:assert/strict";
import test from "node:test";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import {
	createOAuthState,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	validateCSRFToken,
	validateOAuthState,
} from "../src/oauth/workers-oauth-utils.ts";

function memoryKv() {
	const entries = new Map<string, string>();
	let getCount = 0;
	return {
		kv: {
			async put(key: string, value: string) {
				entries.set(key, value);
			},
			async get(key: string) {
				getCount++;
				return entries.get(key) ?? null;
			},
			async delete(key: string) {
				entries.delete(key);
			},
		} as unknown as KVNamespace,
		getCount: () => getCount,
	};
}

test("upstream authorization URL uses authorization code flow and S256 PKCE", () => {
	const result = new URL(
		getUpstreamAuthorizeUrl({
			upstream_url: "https://team.cloudflareaccess.com/authorize",
			client_id: "client",
			redirect_uri: "https://worker.example/callback",
			scope: "openid email profile",
			state: "signed-state",
			code_challenge: "challenge",
		}),
	);
	assert.equal(result.searchParams.get("response_type"), "code");
	assert.equal(result.searchParams.get("code_challenge_method"), "S256");
	assert.equal(result.searchParams.get("state"), "signed-state");
});

test("CSRF validation rejects mismatched form and cookie tokens", () => {
	const { token } = generateCSRFProtection();
	const form = new FormData();
	form.set("csrf_token", token);
	assert.throws(
		() =>
			validateCSRFToken(
				form,
				new Request("https://worker.example/authorize", {
					headers: { Cookie: "__Host-CSRF_TOKEN=different" },
				}),
			),
		/CSRF token mismatch/,
	);
});

test("OAuth state is signed, checked before KV lookup, and consumed once", async () => {
	const store = memoryKv();
	const authRequest = {
		responseType: "code",
		clientId: "chatgpt-client",
		redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
		state: "client-state",
		codeChallenge: "client-challenge",
		codeChallengeMethod: "S256",
	} as unknown as AuthRequest;
	const secret = "state-secret-for-tests";
	const { stateToken, codeChallenge } = await createOAuthState(authRequest, store.kv, secret);

	assert.match(codeChallenge, /^[A-Za-z0-9_-]{43}$/);
	const finalCharacter = stateToken.at(-1);
	const tamperedState = `${stateToken.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;
	await assert.rejects(
		validateOAuthState(
			new Request(`https://worker.example/callback?state=${encodeURIComponent(tamperedState)}`),
			store.kv,
			secret,
		),
		/Invalid state signature/,
	);
	assert.equal(store.getCount(), 0, "tampered state must be rejected before KV lookup");

	const first = await validateOAuthState(
		new Request(`https://worker.example/callback?state=${encodeURIComponent(stateToken)}`),
		store.kv,
		secret,
	);
	assert.equal(first.oauthReqInfo.clientId, "chatgpt-client");
	assert.match(first.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(store.getCount(), 1);

	await assert.rejects(
		validateOAuthState(
			new Request(`https://worker.example/callback?state=${encodeURIComponent(stateToken)}`),
			store.kv,
			secret,
		),
		/Invalid or expired state/,
	);
	assert.equal(store.getCount(), 2);
});
