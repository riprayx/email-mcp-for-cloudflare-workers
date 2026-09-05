import assert from "node:assert/strict";
import test from "node:test";
import {
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	validateCSRFToken,
} from "../src/oauth/workers-oauth-utils.ts";

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
