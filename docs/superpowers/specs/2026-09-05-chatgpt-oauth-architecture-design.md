# ChatGPT OAuth architecture for Universal Email MCP

Date: 2026-09-05
Branch: `feat/universal-email-mcp`
Status: design approved in chat; implementation pending written-spec review

## Problem

The current deployment protects the entire `email-mcp-server` Worker with a Cloudflare Access self-hosted application and enables Access Managed OAuth. Browser/OTP authentication succeeds, but ChatGPT does not reach the MCP initialization flow reliably and the custom app remains in `Reconnect` state. Worker observability showed no `/mcp` invocation during the failing ChatGPT connection attempts, so the failure occurs before mailbox code, KV reads, or MCP tool execution.

The mailbox backend itself is not the target of this change. Existing encrypted account storage in `EMAIL_KV`, provider presets, IMAP/SMTP behavior, and MCP permission modes remain intact.

## Goals

1. Give ChatGPT a conventional MCP OAuth 2.1 endpoint with discovery, Dynamic Client Registration, PKCE, authorization-code exchange, access tokens, and refresh tokens managed by the Worker.
2. Continue using Cloudflare Access as the human identity provider and keep access limited to the approved user identity.
3. Keep the mailbox-management Web UI protected by Cloudflare Access.
4. Preserve existing `EMAIL_KV` mailbox data and `CREDENTIAL_ENCRYPTION_KEY` without migration or re-entry.
5. Preserve the existing MCP URL: `https://email-mcp-server.prayer777.workers.dev/mcp`.
6. Avoid merging PR #1 as part of this work.

## Non-goals

- Gmail OAuth onboarding.
- Reworking IMAP/SMTP providers or mailbox data models.
- Changing the `read` / `mail` / `full` MCP permission semantics.
- Exposing mailbox administration tools to ChatGPT when `MCP_PERMISSION_MODE=mail`.
- Making the management UI public.

## Chosen architecture

Deploy the same project in two Cloudflare Worker roles with shared mailbox storage but separate authentication responsibilities.

### 1. MCP Worker: `email-mcp-server`

This remains the ChatGPT-facing endpoint.

It will no longer sit behind the current self-hosted Access gate. Instead, the Worker will use `@cloudflare/workers-oauth-provider` as its MCP OAuth authorization server. It will expose the standard MCP/OAuth surface including:

- OAuth discovery under `/.well-known/*`
- Dynamic Client Registration at `/register`
- authorization at `/authorize`
- callback at `/callback`
- token exchange and refresh at `/token`
- MCP Streamable HTTP at `/mcp`

`MyMCP.serve("/mcp")` remains the API handler so the current MCP tools and Durable Object architecture are retained.

### 2. Cloudflare Access for SaaS as upstream identity provider

The Worker-owned OAuth server will delegate human authentication to a Cloudflare Access for SaaS OIDC application. This follows Cloudflare's official `remote-mcp-cf-access` pattern rather than relying on Access Managed OAuth as the MCP authorization server itself.

The Access for SaaS callback is the Worker route:

`https://email-mcp-server.prayer777.workers.dev/callback`

The callback verifies the upstream ID token, extracts the user's identity, enforces the approved-email policy, and then completes the MCP client's authorization through `workers-oauth-provider`.

The MCP client never receives the upstream Cloudflare Access ID token or mailbox credentials. It receives only the Worker OAuth token issued for the MCP connection.

### 3. Admin Worker: `email-mcp-admin`

The existing browser management UI moves to a separate Worker deployment:

`https://email-mcp-admin.prayer777.workers.dev`

This Worker keeps the current Cloudflare Access JWT validation model using `Cf-Access-Jwt-Assertion`, `TEAM_DOMAIN`, and `POLICY_AUD`. The current self-hosted Access application will be retargeted from `email-mcp-server` to `email-mcp-admin` after the admin deployment is verified.

The admin deployment exposes the Web UI and mailbox-management HTTP routes only. It must not expose `/mcp`.

### 4. Shared mailbox data

Both Workers bind the existing `EMAIL_KV` namespace and use the same `CREDENTIAL_ENCRYPTION_KEY`.

No mailbox account records are copied, decrypted, or rewritten. Existing Gmail/163/QQ/custom mailbox configurations remain available after the split.

OAuth state is stored separately in a new dedicated `OAUTH_KV` namespace so OAuth authorization state, client registrations, and approval state do not mix with encrypted mailbox-account storage.

## Request flows

### ChatGPT MCP flow

1. ChatGPT requests OAuth discovery from `email-mcp-server`.
2. The Worker OAuth provider advertises DCR, authorization, and token endpoints.
3. ChatGPT dynamically registers its client and starts authorization with PKCE.
4. `/authorize` redirects the browser to Cloudflare Access for SaaS.
5. The user authenticates through the configured Access identity provider.
6. Cloudflare redirects to `/callback`.
7. The Worker exchanges the upstream code, verifies the ID token and approved identity, and completes MCP authorization.
8. ChatGPT receives its Worker-issued OAuth authorization code and exchanges it at `/token`.
9. ChatGPT calls `/mcp` with the resulting bearer token.
10. `workers-oauth-provider` validates the token and invokes `MyMCP.serve("/mcp")`.
11. `tools/list` exposes the tools permitted by `MCP_PERMISSION_MODE`.
12. Refresh tokens allow ChatGPT to refresh without showing `Reconnect` when the short-lived access token expires.

### Admin flow

1. Browser opens `email-mcp-admin`.
2. The existing self-hosted Cloudflare Access application authenticates the user.
3. Access injects `Cf-Access-Jwt-Assertion`.
4. The admin Worker validates issuer, audience, and identity.
5. The existing management UI reads/writes the same encrypted mailbox records in `EMAIL_KV`.

## Code structure

The change should isolate authentication from mailbox functionality.

Expected additions or changes:

- Add `@cloudflare/workers-oauth-provider` dependency.
- Add an OAuth handler module based on Cloudflare's reference implementation, responsible only for authorization, callback, upstream token exchange, identity verification, and OAuth completion.
- Keep `MyMCP` tool registration and mailbox services independent of the OAuth transport.
- Split the current top-level Worker routing into explicit MCP and admin entrypoints, or a small shared factory plus two entrypoint files.
- Extend Cloudflare config generation to produce separate MCP and admin deployment configs.
- Add a dedicated `OAUTH_KV` binding for the MCP Worker.
- Keep `EMAIL_KV` bound to both deployments.
- Keep `CREDENTIAL_ENCRYPTION_KEY` identical on both deployments.

The implementation should prefer separate entrypoint files over a large `DEPLOYMENT_ROLE` conditional in one fetch handler, because the security boundary is clearer and each deployment can expose only the routes it needs.

## Secrets and configuration

### Shared mailbox secret

- `CREDENTIAL_ENCRYPTION_KEY`: same value in MCP and admin Workers.

### MCP Worker OAuth configuration

- `ACCESS_CLIENT_ID`
- `ACCESS_CLIENT_SECRET`
- `ACCESS_AUTHORIZATION_URL`
- `ACCESS_TOKEN_URL`
- `ACCESS_JWKS_URL`
- `COOKIE_ENCRYPTION_KEY`
- `OAUTH_KV`
- `EMAIL_KV`
- existing mail-provider secrets needed by mailbox operations
- `MCP_PERMISSION_MODE`

### Admin Worker Access configuration

- `TEAM_DOMAIN`
- `POLICY_AUD`
- `CREDENTIAL_ENCRYPTION_KEY`
- `EMAIL_KV`
- existing mail-provider secrets needed by the UI/backend

Secrets must never be committed to GitHub or printed in build logs.

## Security properties

- ChatGPT receives a revocable OAuth token, not a mailbox password and not the Cloudflare upstream ID token.
- PKCE is required for authorization-code clients.
- Dynamic client registration is handled by the Worker OAuth provider.
- Upstream identity is verified cryptographically using Cloudflare Access JWKS.
- Authorization is restricted to the approved email identity before the MCP authorization is completed.
- Mailbox credentials remain AES-GCM encrypted in the existing KV record.
- OAuth state uses a separate KV namespace.
- The admin UI remains inaccessible without Cloudflare Access.
- The MCP Worker does not expose account-administration MCP tools while `MCP_PERMISSION_MODE=mail`.

## Failure handling

- Invalid or expired OAuth state: return a standards-compatible OAuth error and do not issue a token.
- Upstream Access denial: do not complete Worker OAuth authorization.
- Unapproved identity: fail authorization before creating an MCP grant.
- Invalid/expired MCP bearer token: return the OAuth/MCP unauthorized response expected by the provider library.
- Failed token refresh: require reconnect; do not silently fall back to unauthenticated MCP access.
- Admin Access JWT failure: retain current 401/403 behavior.
- Existing mailbox/SMTP ambiguity handling remains unchanged.

## Test strategy

Development follows TDD. Tests must fail for the missing behavior before production changes are added.

Minimum regression coverage:

1. OAuth metadata exposes authorization, registration, and token endpoints.
2. DCR accepts a valid ChatGPT-style HTTPS redirect and rejects invalid redirect input as required by the provider library.
3. Authorization uses PKCE and preserves state across the upstream Access round trip.
4. Callback rejects an invalid state.
5. Callback rejects an unapproved email identity.
6. Callback accepts the approved identity and completes authorization.
7. Access-token authorization reaches MCP `initialize` and `tools/list`.
8. Refresh-token exchange issues a new usable access token without requiring interactive login while the grant remains valid.
9. `email_list_accounts` remains present in `mail` mode.
10. Admin entrypoint rejects unauthenticated browser requests.
11. Admin entrypoint does not expose `/mcp`.
12. Existing provider, NetEase, permission, OAuth-routing, and SMTP-failure tests remain green.
13. Repository-wide type-check, test, lint, format check, public-config check, and generated Worker type check are run before completion.

## Deployment sequence

The migration must avoid losing access to the management UI or mailbox data.

1. Implement and test both entrypoints on `feat/universal-email-mcp`.
2. Create the new `OAUTH_KV` namespace.
3. Create and deploy `email-mcp-admin` with the existing shared `EMAIL_KV` and encryption key.
4. Protect `email-mcp-admin` with the existing self-hosted Access policy and verify browser login plus account listing.
5. Create the Access for SaaS OIDC application for the MCP Worker and set its callback to `/callback`.
6. Configure MCP Worker OAuth secrets and bindings.
7. Deploy the OAuth-aware `email-mcp-server`.
8. Verify discovery, DCR, OAuth callback, token exchange, refresh, `initialize`, and `tools/list` before changing ChatGPT.
9. Recreate or reconnect the ChatGPT custom app to `https://email-mcp-server.prayer777.workers.dev/mcp`.
10. Verify `email_list_accounts` end to end.
11. Wait beyond one access-token lifetime and verify automatic refresh keeps the ChatGPT app connected.
12. Only after all checks pass, remove obsolete Managed OAuth/self-hosted protection from the MCP Worker. Do not delete mailbox KV data.

## Rollback

Before the MCP Worker cutover, the existing deployment remains available. If the new OAuth path fails verification:

- restore the prior `email-mcp-server` deployment version;
- keep `EMAIL_KV` untouched;
- keep `email-mcp-admin` and its Access policy intact if already verified;
- leave PR #1 unmerged;
- retain `OAUTH_KV` for debugging or remove it only after confirming it contains no required state.

No rollback step should rewrite or re-encrypt mailbox account records.

## Acceptance criteria

The change is complete only when all of the following are freshly verified:

- ChatGPT shows the custom Email MCP as connected rather than `Reconnect`.
- ChatGPT can complete MCP initialization and see `email_list_accounts`.
- `email_list_accounts` returns the existing configured mailbox accounts without re-entering credentials.
- A real read-only mailbox operation succeeds through ChatGPT.
- The connection remains usable after the short access token expires and a refresh occurs.
- The admin UI is still protected by Cloudflare Access and can manage the same mailbox accounts.
- Existing mailbox tests and repository-wide checks pass.
- No mailbox credential, OAuth client secret, encryption key, or authorization code is committed or exposed in logs.
