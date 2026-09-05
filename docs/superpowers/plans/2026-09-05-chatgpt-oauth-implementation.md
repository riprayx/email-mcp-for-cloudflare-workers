# ChatGPT OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstable ChatGPT-to-Cloudflare-Managed-OAuth path with a Worker-owned MCP OAuth 2.1 flow backed by Cloudflare Access for SaaS, while moving the mailbox management UI to a separately Access-protected admin Worker without migrating existing mailbox data.

**Architecture:** Extract the existing `MyMCP` agent from the current combined entrypoint, keep `email-mcp-server` as the MCP/OAuth Worker, and create `email-mcp-admin` as the browser-management Worker. The MCP Worker uses `@cloudflare/workers-oauth-provider` for discovery, DCR, PKCE, authorization codes, access tokens, refresh tokens, and bearer validation, while Cloudflare Access for SaaS remains the upstream human identity provider. Both Workers bind the same `EMAIL_KV` and use the same `CREDENTIAL_ENCRYPTION_KEY`; OAuth state uses a new `OAUTH_KV` namespace.

**Tech Stack:** Cloudflare Workers, Durable Objects, Workers KV, `agents` 0.19.x, `@modelcontextprotocol/sdk` 1.29.x, `@cloudflare/workers-oauth-provider` 0.8.x, Hono, JOSE, TypeScript 7, Node 22 native test runner, Wrangler 4.114.x.

**Spec:** `docs/superpowers/specs/2026-09-05-chatgpt-oauth-architecture-design.md`

## Global Constraints

- Work only on `feat/universal-email-mcp`; do not merge PR #1.
- Preserve `https://email-mcp-server.prayer777.workers.dev/mcp` as the ChatGPT MCP URL.
- Preserve the existing `EMAIL_KV` namespace and all encrypted `mail/accounts/v1` records.
- Reuse the existing `CREDENTIAL_ENCRYPTION_KEY` in both Workers; never print or commit its value.
- Keep `MCP_PERMISSION_MODE=mail`, so account administration and permanent deletion remain absent from ChatGPT.
- Do not change provider presets, NetEase IMAP ID behavior, SMTP ambiguity handling, or mailbox data models.
- Do not log mailbox credentials, OAuth codes, access/refresh tokens, client secrets, or encryption keys.
- `email-mcp-admin` must never expose `/mcp`.
- The old self-hosted Access protection must not be removed from `email-mcp-server` until the new MCP OAuth flow is fully verified and the admin Worker is protected.

---

### Task 1: Separate the MCP agent from transport/authentication

**Files:**
- Create: `src/mcp-agent.ts`
- Modify: `src/index.ts`
- Test: `tests/mcp-agent.test.ts`

**Interfaces:**
- Consumes: existing `MailEnv`, `AccountStore`, `MailService`, provider resolution, observability, and permission helpers.
- Produces: `export interface McpIdentityProps` and `export class MyMCP extends McpAgent<MailEnv, Record<string, never>, McpIdentityProps>` for both OAuth transport and Wrangler Durable Object bindings.

- [ ] **Step 1: Write a failing import/identity test**

Create `tests/mcp-agent.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MyMCP, type McpIdentityProps } from "../src/mcp-agent.ts";

test("MCP agent is transport-independent and accepts authenticated identity props", () => {
  const identity: McpIdentityProps = {
    accessToken: "upstream-token",
    email: "user@example.com",
    login: "subject-1",
    name: "User",
  };
  assert.equal(typeof MyMCP, "function");
  assert.equal(identity.email, "user@example.com");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/mcp-agent.test.ts
```

Expected: FAIL because `src/mcp-agent.ts` does not exist.

- [ ] **Step 3: Extract `MyMCP` without changing its tool surface**

Move the MCP schemas, annotations, helper functions, and complete `MyMCP` class from `src/index.ts` to `src/mcp-agent.ts`. Add:

```ts
export interface McpIdentityProps {
  accessToken: string;
  email: string;
  login: string;
  name: string;
  [key: string]: unknown;
}

export class MyMCP extends McpAgent<MailEnv, Record<string, never>, McpIdentityProps> {
  server = new McpServer({ name: "email-mcp-server", version: "1.0.0" });
  // existing init() and all 22 registered tools remain byte-for-byte equivalent in behavior
}
```

Temporarily keep the current Access-protected request behavior in `src/index.ts`, but import `MyMCP` from `./mcp-agent` and re-export it so the existing Durable Object configuration still resolves:

```ts
import { MyMCP } from "./mcp-agent";
export { MyMCP } from "./mcp-agent";
```

- [ ] **Step 4: Run focused and permission regressions**

Run:

```bash
node --test tests/mcp-agent.test.ts tests/permissions.test.ts
npm run type-check
```

Expected: PASS; permission matrix still covers all 22 tools, including `email_list_accounts` in `mail` mode.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-agent.ts src/index.ts tests/mcp-agent.test.ts
git commit -m "refactor: separate MCP agent from transport"
```

---

### Task 2: Isolate reusable Cloudflare Access JWT verification for the admin Worker

**Files:**
- Create: `src/access-jwt.ts`
- Modify: `src/index.ts`
- Test: `tests/access-jwt.test.ts`

**Interfaces:**
- Consumes: `TEAM_DOMAIN`, `POLICY_AUD`, JOSE `createRemoteJWKSet` and `jwtVerify`.
- Produces: `verifyAccessJwt(token: string, env: AccessJwtEnv): Promise<AccessIdentity>` and `AccessIdentity { email, sub }`.

- [ ] **Step 1: Write the failing configuration test**

Create `tests/access-jwt.test.ts`:

```ts
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
    () => validateAccessJwtEnvironment({ TEAM_DOMAIN: "https://team.cloudflareaccess.com", POLICY_AUD: "" }),
    /Cloudflare Access is not configured/,
  );
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/access-jwt.test.ts
```

Expected: FAIL because `src/access-jwt.ts` is absent.

- [ ] **Step 3: Move JWT verification into the new module**

Implement:

```ts
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
  if (!teamDomain.startsWith("https://") || !env.POLICY_AUD) {
    throw new Error("Cloudflare Access is not configured");
  }
  return teamDomain;
}

let cachedTeamDomain: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function verifyAccessJwt(token: string, env: AccessJwtEnv): Promise<AccessIdentity> {
  const teamDomain = validateAccessJwtEnvironment(env);
  if (!cachedJwks || cachedTeamDomain !== teamDomain) {
    cachedTeamDomain = teamDomain;
    cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  }
  const { payload } = await jwtVerify(token, cachedJwks, {
    issuer: teamDomain,
    audience: env.POLICY_AUD,
  });
  if (typeof payload.email !== "string" || typeof payload.sub !== "string") {
    throw new Error("Cloudflare Access token is missing identity claims");
  }
  return { email: payload.email, sub: payload.sub };
}
```

Remove the duplicate verifier from `src/index.ts` and import this module instead.

- [ ] **Step 4: Run tests**

```bash
node --test tests/access.test.ts tests/access-jwt.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/access-jwt.ts src/index.ts tests/access-jwt.test.ts
git commit -m "refactor: isolate Access JWT verification"
```

---

### Task 3: Add Worker OAuth state, PKCE, CSRF, and upstream token helpers

**Files:**
- Create: `src/oauth/workers-oauth-utils.ts`
- Create: `tests/workers-oauth-utils.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `AuthRequest` and `ClientInfo` from `@cloudflare/workers-oauth-provider`, `KVNamespace`, Web Crypto.
- Produces: `OAuthError`, `createOAuthState`, `validateOAuthState`, `generateCSRFProtection`, `validateCSRFToken`, `isClientApproved`, `addApprovedClient`, `renderApprovalDialog`, `getUpstreamAuthorizeUrl`, `fetchUpstreamAuthToken`, and `McpIdentityProps`-compatible upstream identity data.

- [ ] **Step 1: Add the dependency only**

Run:

```bash
npm install @cloudflare/workers-oauth-provider@^0.8.1
```

Expected: `package.json` and `package-lock.json` contain the provider dependency. Do not write production OAuth code yet.

- [ ] **Step 2: Write failing helper tests**

Create `tests/workers-oauth-utils.test.ts` with tests for S256 PKCE URL construction, one-time signed state, malformed state rejection, and CSRF mismatch:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  getUpstreamAuthorizeUrl,
  generateCSRFProtection,
  validateCSRFToken,
} from "../src/oauth/workers-oauth-utils.ts";

test("upstream authorization URL uses authorization code flow and S256 PKCE", () => {
  const result = new URL(getUpstreamAuthorizeUrl({
    upstream_url: "https://team.cloudflareaccess.com/authorize",
    client_id: "client",
    redirect_uri: "https://worker.example/callback",
    scope: "openid email profile",
    state: "signed-state",
    code_challenge: "challenge",
  }));
  assert.equal(result.searchParams.get("response_type"), "code");
  assert.equal(result.searchParams.get("code_challenge_method"), "S256");
  assert.equal(result.searchParams.get("state"), "signed-state");
});

test("CSRF validation rejects mismatched form and cookie tokens", () => {
  const { token } = generateCSRFProtection();
  const form = new FormData();
  form.set("csrf_token", token);
  assert.throws(
    () => validateCSRFToken(form, new Request("https://worker.example/authorize", {
      headers: { Cookie: "__Host-CSRF_TOKEN=different" },
    })),
    /CSRF token mismatch/,
  );
});
```

- [ ] **Step 3: Run RED**

```bash
node --test tests/workers-oauth-utils.test.ts
```

Expected: FAIL because the helper module is absent.

- [ ] **Step 4: Implement the helpers from Cloudflare's current reference pattern**

Port the security-relevant behavior from Cloudflare's `remote-mcp-cf-access` reference rather than inventing a new protocol layer. Required state format:

```ts
const uuid = crypto.randomUUID();
const hmac = await signData(uuid, secret);
const stateToken = `${uuid}.${hmac}`;
await kv.put(`oauth:state:${uuid}`, JSON.stringify({ oauthReqInfo, codeVerifier }), {
  expirationTtl: 600,
});
```

`validateOAuthState` must verify the HMAC before KV lookup, delete the state after successful lookup, and return the stored `AuthRequest` plus PKCE verifier. `fetchUpstreamAuthToken` must send `grant_type=authorization_code`, the original `redirect_uri`, and `code_verifier` to Access for SaaS. Do not log upstream error bodies because they can contain sensitive provider details; return a generic OAuth error to the client and log only a safe category.

- [ ] **Step 5: Run GREEN and repository safety tests**

```bash
node --test tests/workers-oauth-utils.test.ts tests/observability.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/oauth/workers-oauth-utils.ts tests/workers-oauth-utils.test.ts
git commit -m "feat: add MCP OAuth security helpers"
```

---

### Task 4: Implement Cloudflare Access for SaaS authorization handler and Worker-owned MCP OAuth entrypoint

**Files:**
- Create: `src/oauth/access-handler.ts`
- Rewrite: `src/index.ts`
- Modify: `src/mail/types.ts`
- Test: `tests/mcp-oauth.test.ts`

**Interfaces:**
- Consumes: `Env.OAUTH_PROVIDER` from `@cloudflare/workers-oauth-provider`, OAuth helper module, upstream Access OIDC endpoints/secrets, `MyMCP`.
- Produces: `/authorize`, `/callback`, `/register`, `/token`, discovery endpoints, and bearer-protected `/mcp`.

- [ ] **Step 1: Write failing authorization-policy tests**

Add `tests/mcp-oauth.test.ts` around an exported pure helper:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedIdentity } from "../src/oauth/access-handler.ts";

test("only the configured Access identity can complete MCP authorization", () => {
  assert.doesNotThrow(() =>
    assertApprovedIdentity("riprayx@gmail.com", "riprayx@gmail.com"),
  );
  assert.throws(
    () => assertApprovedIdentity("other@example.com", "riprayx@gmail.com"),
    /not authorized/,
  );
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/mcp-oauth.test.ts
```

Expected: FAIL because `src/oauth/access-handler.ts` is absent.

- [ ] **Step 3: Implement the upstream Access handler**

The handler must follow this route contract:

```ts
if (request.method === "GET" && pathname === "/authorize") {
  const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  // render approval or reuse approved-client cookie
  // create signed OAuth state + PKCE
  // redirect to ACCESS_AUTHORIZATION_URL
}

if (request.method === "POST" && pathname === "/authorize") {
  // validate CSRF
  // approve client cookie
  // create signed OAuth state + PKCE
  // redirect to Access for SaaS
}

if (request.method === "GET" && pathname === "/callback") {
  // validate one-time state
  // exchange upstream code using PKCE
  // verify Access ID token with ACCESS_JWKS_URL
  // require claims.email === env.ALLOWED_EMAIL
  // env.OAUTH_PROVIDER.completeAuthorization(...)
}
```

Use JOSE for the upstream ID token instead of hand-parsing signatures:

```ts
const jwks = createRemoteJWKSet(new URL(env.ACCESS_JWKS_URL));
const issuer = env.ACCESS_AUTHORIZATION_URL.replace(/\/authorization$/, "");
const { payload } = await jwtVerify(idToken, jwks, {
  issuer,
  audience: env.ACCESS_CLIENT_ID,
});
```

Validate `email`, `sub`, expiration, issuer, and audience before `completeAuthorization`.

- [ ] **Step 4: Replace `src/index.ts` with the OAuth provider entrypoint**

The final top-level shape must be:

```ts
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { MyMCP } from "./mcp-agent";
import { handleAccessRequest } from "./oauth/access-handler";

export { MyMCP } from "./mcp-agent";

export default new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: { fetch: handleAccessRequest as any },
  tokenEndpoint: "/token",
});
```

The MCP entrypoint must no longer call `accessRejection` or route to the management Hono app.

- [ ] **Step 5: Extend environment typing**

In `src/mail/types.ts`, add optional/required fields used at runtime without placing literal values in source:

```ts
export interface MailEnv extends Cloudflare.Env {
  MCP_PERMISSION_MODE?: string;
  ALLOWED_EMAIL: string;
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_KV: KVNamespace;
}
```

- [ ] **Step 6: Run tests and type-check**

```bash
node --test tests/mcp-agent.test.ts tests/mcp-oauth.test.ts tests/workers-oauth-utils.test.ts tests/permissions.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/mail/types.ts src/oauth/access-handler.ts tests/mcp-oauth.test.ts
git commit -m "feat: serve MCP through Worker OAuth"
```

---

### Task 5: Create the dedicated Access-protected admin Worker entrypoint

**Files:**
- Create: `src/admin.ts`
- Test: `tests/admin-entry.test.ts`

**Interfaces:**
- Consumes: existing `app`, `accessRejection`, `verifyAccessJwt`, and shared mailbox env.
- Produces: browser-management handler only; `/mcp` is always `404` even after valid Access authentication.

- [ ] **Step 1: Write failing route-boundary tests**

Create `tests/admin-entry.test.ts` using a small injectable factory exported from `src/admin.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHandler } from "../src/admin.ts";

test("admin worker never exposes /mcp", async () => {
  const handler = createAdminHandler({ verify: async () => ({ email: "u", sub: "s" }) });
  const response = await handler.fetch(
    new Request("https://admin.example/mcp", {
      headers: { "Cf-Access-Jwt-Assertion": "valid" },
    }),
    { ACCESS_LOCAL_DEV: "false" } as any,
    {} as ExecutionContext,
  );
  assert.equal(response.status, 404);
});

test("admin worker rejects requests without Access assertion", async () => {
  const handler = createAdminHandler({ verify: async () => ({ email: "u", sub: "s" }) });
  const response = await handler.fetch(
    new Request("https://admin.example/"),
    { ACCESS_LOCAL_DEV: "false" } as any,
    {} as ExecutionContext,
  );
  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/admin-entry.test.ts
```

Expected: FAIL because `src/admin.ts` is absent.

- [ ] **Step 3: Implement the admin handler**

```ts
import { accessRejection } from "./access";
import { verifyAccessJwt } from "./access-jwt";
import app from "./app";
import type { MailEnv } from "./mail/types";

export function createAdminHandler(deps = { verify: verifyAccessJwt }) {
  return {
    async fetch(request: Request, env: MailEnv, ctx: ExecutionContext): Promise<Response> {
      const rejection = await accessRejection(request, env, (token) => deps.verify(token, env));
      if (rejection) return rejection;
      const pathname = new URL(request.url).pathname;
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        return new Response("Not Found", { status: 404 });
      }
      return app.fetch(request, env, ctx);
    },
  } satisfies ExportedHandler<MailEnv>;
}

export default createAdminHandler();
```

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/admin-entry.test.ts tests/access.test.ts tests/access-jwt.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin.ts tests/admin-entry.test.ts
git commit -m "feat: add isolated mailbox admin worker"
```

---

### Task 6: Generate separate private Wrangler configs for MCP and admin deployments

**Files:**
- Modify: `scripts/generate-cloudflare-config.mjs`
- Modify: `tests/cloudflare-config.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.dev.vars.example`
- Modify: `scripts/check-public-config.mjs`

**Interfaces:**
- Consumes: `EMAIL_KV_NAMESPACE_ID` for both Workers and `OAUTH_KV_NAMESPACE_ID` for the MCP Worker.
- Produces: ignored `wrangler.mcp.generated.json` and `wrangler.admin.generated.json`.

- [ ] **Step 1: Rewrite config tests first**

The test must assert these exact boundaries:

```ts
const configs = buildCloudflareConfigs({
  EMAIL_KV_NAMESPACE_ID: "a".repeat(32),
  OAUTH_KV_NAMESPACE_ID: "b".repeat(32),
});

assert.equal(configs.mcp.name, "email-mcp-server");
assert.equal(configs.mcp.main, "src/index.ts");
assert.deepEqual(configs.mcp.kv_namespaces, [
  { binding: "EMAIL_KV", id: "a".repeat(32) },
  { binding: "OAUTH_KV", id: "b".repeat(32) },
]);
assert.equal(configs.admin.name, "email-mcp-admin");
assert.equal(configs.admin.main, "src/admin.ts");
assert.deepEqual(configs.admin.kv_namespaces, [
  { binding: "EMAIL_KV", id: "a".repeat(32) },
]);
assert.equal("durable_objects" in configs.admin, false);
```

MCP required secrets:

```ts
[
  "CREDENTIAL_ENCRYPTION_KEY",
  "OUTLOOK_CLIENT_SECRET",
  "ACCESS_CLIENT_ID",
  "ACCESS_CLIENT_SECRET",
  "ACCESS_TOKEN_URL",
  "ACCESS_AUTHORIZATION_URL",
  "ACCESS_JWKS_URL",
  "COOKIE_ENCRYPTION_KEY",
  "ALLOWED_EMAIL",
]
```

Admin required secrets:

```ts
[
  "CREDENTIAL_ENCRYPTION_KEY",
  "OUTLOOK_CLIENT_SECRET",
  "TEAM_DOMAIN",
  "POLICY_AUD",
]
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/cloudflare-config.test.ts
```

Expected: FAIL because only one generated config exists today.

- [ ] **Step 3: Implement two config builders/writers**

Use:

```js
export const generatedMcpConfigPath = "wrangler.mcp.generated.json";
export const generatedAdminConfigPath = "wrangler.admin.generated.json";

export function buildCloudflareConfigs(environment = process.env) {
  // validate EMAIL_KV_NAMESPACE_ID and OAUTH_KV_NAMESPACE_ID as 32-char hex
  return { mcp: buildMcpConfig(...), admin: buildAdminConfig(...) };
}
```

Both outputs keep `compatibility_date: "2026-06-14"`, `nodejs_compat`, `keep_vars: true`, and observability enabled. Only MCP carries the `MyMCP` Durable Object migration/binding.

- [ ] **Step 4: Update package scripts**

Add explicit scripts:

```json
{
  "cloudflare:config": "node scripts/generate-cloudflare-config.mjs",
  "cloudflare:deploy:mcp": "npm run cloudflare:config && wrangler deploy --config wrangler.mcp.generated.json",
  "cloudflare:deploy:admin": "npm run cloudflare:config && wrangler deploy --config wrangler.admin.generated.json",
  "cloudflare:upload:mcp": "npm run cloudflare:config && wrangler versions upload --config wrangler.mcp.generated.json",
  "cloudflare:upload:admin": "npm run cloudflare:config && wrangler versions upload --config wrangler.admin.generated.json"
}
```

Do not leave a generic deploy script that ambiguously targets the wrong Worker.

- [ ] **Step 5: Harden public-config checks**

`.gitignore` must contain both generated config filenames. `scripts/check-public-config.mjs` must reject literal Access domains, audiences, OAuth client IDs/secrets, allowed email addresses, or real KV IDs in checked-in config/example files.

`.dev.vars.example` may contain names but only placeholders:

```dotenv
CREDENTIAL_ENCRYPTION_KEY="replace-with-output-of-openssl-rand-base64-32"
ACCESS_LOCAL_DEV="true"
OUTLOOK_CLIENT_ID="your-microsoft-entra-application-client-id"
OUTLOOK_CLIENT_SECRET="your-microsoft-entra-client-secret"
OUTLOOK_TENANT="consumers"
ACCESS_CLIENT_ID="your-access-for-saas-client-id"
ACCESS_CLIENT_SECRET="your-access-for-saas-client-secret"
ACCESS_TOKEN_URL="https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-id/token"
ACCESS_AUTHORIZATION_URL="https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-id/authorization"
ACCESS_JWKS_URL="https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-id/jwks"
COOKIE_ENCRYPTION_KEY="replace-with-output-of-openssl-rand-hex-32"
ALLOWED_EMAIL="owner@example.com"
```

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/cloudflare-config.test.ts
npm run public-config:check
npm run type-check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-cloudflare-config.mjs scripts/check-public-config.mjs tests/cloudflare-config.test.ts package.json .gitignore .dev.vars.example
git commit -m "feat: split MCP and admin deployment configs"
```

---

### Task 7: Update operator documentation and run the complete local verification gate

**Files:**
- Modify: `README.md`
- Modify: `docs/UNIVERSAL_EMAIL.md`
- Modify/regenerate: `worker-configuration.d.ts`

**Interfaces:**
- Produces: exact operator instructions for two Workers and a documented ChatGPT endpoint.

- [ ] **Step 1: Update documentation**

Document these facts explicitly:

```text
MCP endpoint: https://email-mcp-server.<workers-subdomain>.workers.dev/mcp
Admin UI:     https://email-mcp-admin.<workers-subdomain>.workers.dev/
```

State that `EMAIL_KV` and `CREDENTIAL_ENCRYPTION_KEY` are shared, `OAUTH_KV` is MCP-only, mailbox credentials should be entered through the admin UI, and default `mail` permission mode excludes account administration and permanent deletion from MCP.

- [ ] **Step 2: Regenerate Worker types**

Run the repository's Wrangler type generation after the config/type changes:

```bash
npm run cf-typegen
```

Review the generated declarations to ensure no literal real domain, audience, email, OAuth client secret, or encryption key is present.

- [ ] **Step 3: Run the full repository verification gate**

Run exactly:

```bash
npm test
npm run lint
npm run format:check
npm run public-config:check
npm run cf-typegen:check
```

Expected: all commands exit 0. Do not proceed to Cloudflare deployment if any command fails.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/UNIVERSAL_EMAIL.md worker-configuration.d.ts
git commit -m "docs: document split OAuth deployment"
```

---

### Task 8: Provision Cloudflare resources and deploy the admin Worker first

**Cloudflare resources:**
- Existing shared KV: `email-mcp-kv` / `40161c300478432c8d8741c79b315b8a`
- Create: `email-mcp-oauth` KV namespace
- Create/deploy: Worker `email-mcp-admin`
- Preserve until cutover: current `email-mcp-server` and current self-hosted Access application.

- [ ] **Step 1: Create a dedicated OAuth KV namespace**

Use Cloudflare API/connector to create one namespace named `email-mcp-oauth`. Record only its 32-character namespace ID in the Cloudflare Builds secret `OAUTH_KV_NAMESPACE_ID`; do not commit it to a public config file.

- [ ] **Step 2: Add the new build secret**

The existing repository build trigger must receive:

```text
EMAIL_KV_NAMESPACE_ID=<existing email-mcp-kv id>
OAUTH_KV_NAMESPACE_ID=<new oauth namespace id>
```

Both are build-time binding IDs, not mailbox credentials.

- [ ] **Step 3: Deploy `email-mcp-admin` using the admin generated config**

Set/copy the runtime secret names without revealing values:

```text
CREDENTIAL_ENCRYPTION_KEY
OUTLOOK_CLIENT_SECRET
TEAM_DOMAIN
POLICY_AUD
```

The admin Worker must receive the exact same `CREDENTIAL_ENCRYPTION_KEY` as the current deployment.

- [ ] **Step 4: Protect the admin Worker with Access**

Update the existing self-hosted Access application's Worker destination to the immutable tag of `email-mcp-admin`, preserving the exact allow policy for `riprayx@gmail.com`. Keep the old MCP Worker deployment available for rollback until admin verification passes.

- [ ] **Step 5: Verify the admin boundary**

Fresh evidence required:

```text
unauthenticated GET /           -> Access challenge/deny
approved browser GET /          -> management UI
management UI account list      -> existing saved accounts visible
GET /mcp after authentication   -> 404
```

Do not continue if the existing accounts are missing; that would indicate wrong `EMAIL_KV` or wrong encryption key.

---

### Task 9: Create Access for SaaS OIDC upstream and deploy the OAuth-aware MCP Worker

**Cloudflare resources:**
- Create: Access for SaaS OIDC application `Email MCP OAuth Upstream`
- Callback: `https://email-mcp-server.prayer777.workers.dev/callback`
- Policy: allow only `riprayx@gmail.com`

- [ ] **Step 1: Create the Access for SaaS OIDC application**

Use the Cloudflare Access application API with this shape:

```json
{
  "name": "Email MCP OAuth Upstream",
  "type": "saas",
  "saas_app": {
    "auth_type": "oidc",
    "redirect_uris": [
      "https://email-mcp-server.prayer777.workers.dev/callback"
    ],
    "grant_type": ["authorization_code", "refresh_tokens"],
    "refresh_token_options": { "lifetime": "90d" }
  },
  "allowed_idps": []
}
```

Attach an Allow policy whose include selector is exactly the approved email identity. Do not use `Everyone`.

- [ ] **Step 2: Capture the one-time OIDC credentials directly into Worker secrets**

From the created SaaS app, store the returned values as Worker secrets without echoing them into chat/logs:

```text
ACCESS_CLIENT_ID
ACCESS_CLIENT_SECRET
```

Derive and store these secret URLs using the returned client ID and the existing team domain:

```text
ACCESS_TOKEN_URL=https://timeending.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/token
ACCESS_AUTHORIZATION_URL=https://timeending.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/authorization
ACCESS_JWKS_URL=https://timeending.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<CLIENT_ID>/jwks
```

Generate a fresh `COOKIE_ENCRYPTION_KEY` with 32 random bytes/64 hex characters and store it as a Worker secret. Set `ALLOWED_EMAIL` to the approved identity as a Worker secret. Preserve the existing mailbox `CREDENTIAL_ENCRYPTION_KEY`, `OUTLOOK_CLIENT_SECRET`, and `MCP_PERMISSION_MODE=mail`.

- [ ] **Step 3: Deploy `email-mcp-server` from `feat/universal-email-mcp`**

The resulting Worker must bind both `EMAIL_KV` and `OAUTH_KV`, plus the existing `MyMCP` Durable Object.

- [ ] **Step 4: Remove the old self-hosted Access gate from the MCP Worker only after deployment**

The MCP hostname must no longer be captured by the old self-hosted Access application; that application now protects the admin Worker. Do not enable Access Managed OAuth on the MCP hostname because Worker-owned OAuth is now authoritative.

---

### Task 10: Perform protocol-level and ChatGPT end-to-end verification before declaring success

**Verification targets:**
- OAuth discovery
- DCR
- authorization + PKCE
- token exchange
- refresh token
- MCP initialization / tools listing
- mailbox read
- admin isolation

- [ ] **Step 1: Verify OAuth discovery**

Fetch:

```text
https://email-mcp-server.prayer777.workers.dev/.well-known/oauth-authorization-server
https://email-mcp-server.prayer777.workers.dev/.well-known/oauth-protected-resource
```

Confirm metadata advertises HTTPS authorization, token, and registration endpoints pointing to the Worker and that PKCE S256 is supported where advertised.

- [ ] **Step 2: Verify with MCP Inspector before ChatGPT**

Run:

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect to:

```text
https://email-mcp-server.prayer777.workers.dev/mcp
```

Complete Access login and verify `initialize` and `tools/list` succeed. Confirm `email_list_accounts` exists while `email_add_account`, `email_remove_account`, and `email_delete_messages_permanently` do not appear under `MCP_PERMISSION_MODE=mail`.

- [ ] **Step 3: Verify existing mailbox data through MCP**

Call `email_list_accounts` and confirm it returns the existing saved accounts without re-entering credentials. Then run one read-only operation such as `email_get_all_account_mailbox_statuses` or `email_list_all_inbox_messages`.

- [ ] **Step 4: Verify refresh independently of interactive login**

Obtain an MCP OAuth grant through the Inspector or a standards-compliant test client, exchange its refresh token at `/token` using `grant_type=refresh_token`, and use the resulting new access token for another MCP request. This must work without revisiting the Access login page.

- [ ] **Step 5: Reconnect/recreate the ChatGPT custom app**

Use:

```text
Name: Email
URL: https://email-mcp-server.prayer777.workers.dev/mcp
Authentication: OAuth
```

Complete the Access login and verify ChatGPT can invoke `email_list_accounts`.

- [ ] **Step 6: Verify connection persistence past one access-token lifetime**

Wait longer than the OAuth provider's configured short access-token lifetime, then invoke `email_list_accounts` again. Required result: the app remains connected and refreshes automatically; it must not return to `Reconnect`.

- [ ] **Step 7: Re-run Cloudflare observability checks**

Confirm the Worker now receives `/mcp` requests and successful MCP tool events. Logs must contain operational metadata only and no mailbox credential/token content.

- [ ] **Step 8: Final rollback readiness check**

Before claiming completion, record the prior `email-mcp-server` Worker version ID and confirm `EMAIL_KV` has not been rewritten or deleted. If OAuth verification fails, restore the prior Worker version and leave the shared mailbox KV untouched.

- [ ] **Step 9: Final repository and deployment evidence**

Run once more on the deployed branch:

```bash
npm test
npm run lint
npm run format:check
npm run public-config:check
npm run cf-typegen:check
```

Then verify Cloudflare build outcome is `success`, both Workers use the intended bindings, the admin Access policy is still restricted to the approved identity, and PR #1 remains unmerged.
