# Universal Email MCP

This fork keeps the direct Cloudflare Workers IMAP/SMTP architecture and adds a provider-aware mailbox layer plus a split authentication/deployment model for remote MCP clients such as ChatGPT.

## Deployment architecture

Production uses two Workers with separate security boundaries:

```text
MCP endpoint: https://email-mcp-server.<workers-subdomain>.workers.dev/mcp
Admin UI:     https://email-mcp-admin.<workers-subdomain>.workers.dev/
```

`email-mcp-server` exposes the MCP protocol. It owns the OAuth authorization server used by MCP clients through `@cloudflare/workers-oauth-provider`, including protected-resource discovery, authorization, dynamic client registration, token issuance, PKCE, access tokens, and refresh tokens. Cloudflare Access for SaaS is used upstream to authenticate the human identity completing the authorization flow.

`email-mcp-admin` exposes only the mailbox-management Web UI. It remains protected by a normal Cloudflare Access self-hosted application and also validates the Access JWT inside the Worker. It deliberately returns 404 for `/mcp`.

Both Workers bind the same `EMAIL_KV` and must use the same `CREDENTIAL_ENCRYPTION_KEY`; this is what allows the Admin UI and MCP server to use the same encrypted mailbox records without duplicating credentials. Do not rotate that key on an existing deployment unless all stored mailbox credentials are intentionally migrated or discarded.

`OAUTH_KV` is separate and MCP-only. It stores OAuth provider state, registered MCP clients, grants, and tokens. The Admin Worker must not bind it.

Mailbox passwords, app passwords, authorization codes, and provider OAuth credentials should be entered through the Admin UI. They go directly from the browser to the Admin Worker, are encrypted before being stored in `EMAIL_KV`, and do not need to pass through the MCP client or language model.

The repository generates two ignored deployment configurations:

```text
wrangler.mcp.generated.json
wrangler.admin.generated.json
```

Generate them with `npm run cloudflare:config`. Repository-connected builds provide `EMAIL_KV_NAMESPACE_ID` and `OAUTH_KV_NAMESPACE_ID` as build secrets. The MCP deployment uses `npm run cloudflare:deploy:mcp`; the Admin deployment uses `npm run cloudflare:deploy:admin`.

## MCP OAuth configuration

The MCP Worker requires the upstream Cloudflare Access for SaaS/OIDC values as Worker secrets or variables:

```text
ACCESS_CLIENT_ID
ACCESS_CLIENT_SECRET
ACCESS_AUTHORIZATION_URL
ACCESS_TOKEN_URL
ACCESS_JWKS_URL
COOKIE_ENCRYPTION_KEY
ALLOWED_EMAIL
```

`ALLOWED_EMAIL` is the exact identity allowed to complete MCP authorization. Keep the real value in Cloudflare configuration; do not commit it to this repository.

The MCP Worker issues short-lived access tokens and refresh tokens. MCP clients should therefore remain connected when the access token expires instead of requiring a new interactive login.

The Admin Worker uses the ordinary Access settings:

```text
TEAM_DOMAIN
POLICY_AUD
```

Only the Admin Worker should sit directly behind the self-hosted Access application. Do not put the MCP Worker behind an additional self-hosted Access redirect layer, because MCP clients must be able to reach its OAuth discovery and token endpoints.

## Supported providers

Known mailbox domains are detected automatically. Current presets include:

- Gmail
- Outlook / Hotmail / Live
- iCloud / me.com / mac.com
- NetEase 163, VIP 163, 126, VIP 126, 188, VIP 188, and yeah.net
- QQ Mail and Foxmail
- Fastmail
- Yahoo Mail
- Zoho Mail

Any other standards-compliant mailbox remains supported by supplying custom IMAP settings and optional SMTP settings.

## Add an account through MCP

`email_add_account` is registered only in `MCP_PERMISSION_MODE=full`. The default `mail` mode intentionally keeps account administration out of the MCP tool surface; use the Admin UI for account setup when staying on the default mode.

For a known provider, `email_add_account` only needs the account identity and credential. Server settings are inferred from the email domain:

```json
{
	"name": "Personal 163",
	"email": "user@163.com",
	"password": "client-authorization-code"
}
```

The server resolves this to `imap.163.com:993` and `smtp.163.com:465` with implicit TLS.

Use `provider` to select a preset explicitly. Use `provider: "custom"` to disable domain detection and supply your own server settings.

Explicit `imapHost`, `imapPort`, `imapSecure`, `smtpHost`, `smtpPort`, and `smtpSecure` values override preset defaults. Set `smtpEnabled: false` for a read-only mailbox. If the authentication username differs from the mailbox address, set `username`; existing accounts without `username` continue to authenticate with their email address.

## NetEase IMAP compatibility

NetEase IMAP servers require RFC 2971 client identification on affected mailboxes before selecting folders. The Worker automatically sends an `ID` command after authentication for the built-in NetEase IMAP hosts when the server advertises the `ID` capability.

This behavior is based on the actual IMAP host, not the stored provider name. A NetEase account entered through the Admin UI as Custom therefore receives the same compatibility handshake when its IMAP host is `imap.163.com`, `imap.126.com`, `imap.yeah.net`, or one of the supported NetEase VIP/188 hosts.

## Credentials and provider OAuth

Credentials are encrypted with the existing AES-256-GCM account store before being written to Workers KV. Do not put mailbox passwords, app passwords, authorization codes, OAuth tokens, or `CREDENTIAL_ENCRYPTION_KEY` in Git.

For NetEase and QQ Mail, use the provider-issued client authorization code rather than the normal web-login password where the provider requires it.

The native IMAP/SMTP clients can authenticate with a supplied XOAUTH2 access token. Automatic mailbox-token refresh is currently implemented only for the standard Outlook/Microsoft IMAP endpoint. Microsoft refresh is entered only when the stored IMAP host is actually `outlook.office365.com`; the provider label is deliberately not trusted. Gmail and custom OAuth credentials are therefore never sent to the Microsoft token endpoint merely because of provider metadata.

The OAuth used by ChatGPT to authenticate to the MCP server is separate from mailbox-provider OAuth. A ChatGPT refresh token does not grant direct access to Gmail, Outlook, QQ, or NetEase; it only authorizes access to this Worker and the tools exposed by its permission mode.

## MCP permission modes

`MCP_PERMISSION_MODE` controls which tools are registered with MCP clients.

| Mode   | Behavior                                                          |
| ------ | ----------------------------------------------------------------- |
| `read` | Read/search/status/attachments only                               |
| `mail` | Default. Read plus flags, move/archive/trash, drafts, and sending |
| `full` | `mail` plus account add/remove and permanent deletion             |

If the variable is omitted, the server defaults to `mail`. Unknown values fail closed during MCP initialization, and unknown future tool names are not automatically exposed by any permission mode.

The default `mail` mode deliberately excludes account administration and permanent deletion. This permission mode is a deployment-level safety boundary, not a multi-tenant RBAC system.

## Admin Web UI

The management UI remains intentionally small: Gmail, iCloud, Outlook, and Custom. Choose Custom for any other provider and enter its IMAP/SMTP settings manually.

Accounts created through MCP can still be edited in the Admin UI. Provider metadata and a separate login username are preserved when the form saves an account.

The Admin Worker and MCP Worker share the encrypted account store, so an account added at the Admin URL is immediately available to MCP tools without re-entering its credentials.

## Custom server requirements

Custom IMAP is required. SMTP is optional. Hosts must be valid DNS hostnames and ports must be integers from 1 to 65535.

TLS behavior follows the existing transport model:

- `secure: true` uses implicit TLS.
- `secure: false` connects with STARTTLS and upgrades before authentication.

## Safety notes

- Normal deletion should use `email_move_messages_to_trash`.
- Permanent expunge is available only in `full` mode.
- The default `mail` mode intentionally hides account administration and permanent deletion from MCP clients.
- SMTP acceptance means the upstream SMTP server accepted the message for processing; it does not prove final delivery to the recipient inbox.
- If the connection fails after the SMTP DATA payload was transmitted but before the final server response is known, the send fails with an explicit unknown-delivery-state error. Do not retry automatically. The draft is preserved and no Sent copy is appended by this send attempt.
