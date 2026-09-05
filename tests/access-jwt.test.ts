import assert from "node:assert/strict";
import test from "node:test";
import { validateAccessJwtEnvironment } from "../src/access-jwt.ts";

test("Access JWT configuration requires https team domain and audience", () => {
	assert.doesNotThrow(() =>
		validateAccessJwtEnvironment({
			TEAM_DOMAIN: "https://team.cloudflareaccess.com",
			POLICY_AUD: "audience",
		}),
	);
	assert.throws(
		() => validateAccessJwtEnvironment({ TEAM_DOMAIN: "http://bad", POLICY_AUD: "audience" }),
		/Cloudflare Access is not configured/,
	);
	assert.throws(
		() =>
			validateAccessJwtEnvironment({
				TEAM_DOMAIN: "https://team.cloudflareaccess.com",
				POLICY_AUD: "",
			}),
		/Cloudflare Access is not configured/,
	);
});
