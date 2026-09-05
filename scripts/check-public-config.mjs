import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wrangler = await readFile("wrangler.toml", "utf8");
const workerTypes = await readFile("worker-configuration.d.ts", "utf8");
const gitignore = await readFile(".gitignore", "utf8");
const devVars = await readFile(".dev.vars.example", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

assert.doesNotMatch(wrangler, /^\s*account_id\s*=/m, "wrangler.toml must not contain account_id");
assert.match(
	wrangler,
	/id = "replace-with-your-kv-namespace-id"/,
	"wrangler.toml must keep the sanitized KV placeholder",
);
assert.match(
	wrangler,
	/TEAM_DOMAIN = "https:\/\/your-team\.cloudflareaccess\.com"/,
	"wrangler.toml must keep the sanitized Access domain",
);
assert.doesNotMatch(
	wrangler,
	/\bid\s*=\s*"[a-f0-9]{32}"/i,
	"wrangler.toml must not contain a real KV namespace ID",
);

for (const variable of [
	"TEAM_DOMAIN",
	"POLICY_AUD",
	"ACCESS_CLIENT_ID",
	"ACCESS_TOKEN_URL",
	"ACCESS_AUTHORIZATION_URL",
	"ACCESS_JWKS_URL",
	"COOKIE_ENCRYPTION_KEY",
	"ALLOWED_EMAIL",
]) {
	assert.doesNotMatch(
		workerTypes,
		new RegExp(`${variable}:\\s*"`),
		`generated Worker types must not contain a literal ${variable}`,
	);
}
assert.doesNotMatch(
	workerTypes,
	/\bACCESS_CLIENT_SECRET\b/,
	"generated Worker types must not contain the obsolete Access client secret binding",
);

assert.match(
	devVars,
	/^ACCESS_CLIENT_ID="your-access-for-saas-client-id"$/m,
	"development vars must keep a placeholder Access client ID",
);
assert.doesNotMatch(
	devVars,
	/^ACCESS_CLIENT_SECRET=/m,
	"development vars must not advertise an Access client secret for the PKCE public client flow",
);
assert.match(
	devVars,
	/^COOKIE_ENCRYPTION_KEY="replace-with-output-of-openssl-rand-hex-32"$/m,
	"development vars must keep a placeholder OAuth cookie key",
);
assert.match(
	devVars,
	/^ALLOWED_EMAIL="owner@example\.com"$/m,
	"development vars must keep a placeholder allowed email",
);
assert.doesNotMatch(
	devVars,
	/https:\/\/timeending\.cloudflareaccess\.com/i,
	"development vars must not contain a real Access team domain",
);
assert.doesNotMatch(
	devVars,
	/\b[a-f0-9]{32}\b/i,
	"development vars must not contain real namespace identifiers",
);

assert.match(
	gitignore,
	/^wrangler\.mcp\.generated\.json$/m,
	"the generated private MCP config must be ignored",
);
assert.match(
	gitignore,
	/^wrangler\.admin\.generated\.json$/m,
	"the generated private admin config must be ignored",
);

for (const [script, config] of [
	["cloudflare:deploy:mcp", "wrangler.mcp.generated.json"],
	["cloudflare:upload:mcp", "wrangler.mcp.generated.json"],
	["cloudflare:deploy:admin", "wrangler.admin.generated.json"],
	["cloudflare:upload:admin", "wrangler.admin.generated.json"],
]) {
	assert.match(
		packageJson.scripts[script],
		new RegExp(`--config ${config.replaceAll(".", "\\.")}$`),
		`${script} must use its generated private config`,
	);
}
assert.equal(
	packageJson.scripts["cloudflare:deploy"],
	undefined,
	"ambiguous cloudflare:deploy script must not exist",
);
assert.equal(
	packageJson.scripts["cloudflare:upload"],
	undefined,
	"ambiguous cloudflare:upload script must not exist",
);
assert.equal(
	packageJson.scripts.deploy,
	undefined,
	"ambiguous generic deploy script must not exist",
);

console.log("Public configuration is sanitized.");
