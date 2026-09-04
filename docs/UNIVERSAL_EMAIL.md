# Universal Email MCP

This fork keeps the original Cloudflare Workers architecture and adds a universal provider layer on top of the existing IMAP/SMTP implementation.

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

Explicit `imapHost`, `imapPort`, `imapSecure`, `smtpHost`, `smtpPort`, and `smtpSecure` values override preset defaults.

Set `smtpEnabled: false` for a read-only mailbox.

If the authentication username differs from the mailbox address, set `username`. Existing accounts without `username` continue to authenticate with their email address.

## Credentials

Credentials are encrypted with the existing AES-256-GCM account store before being written to Workers KV. Do not put mailbox passwords, app passwords, authorization codes, OAuth tokens, or `CREDENTIAL_ENCRYPTION_KEY` in Git.

For NetEase and QQ Mail, use the provider-issued client authorization code rather than the normal web-login password where the provider requires it.

## MCP permission modes

`MCP_PERMISSION_MODE` controls which tools are registered with MCP clients.

| Mode | Behavior |
| --- | --- |
| `read` | Read/search/status/attachments only |
| `mail` | Default. Read plus flags, move/archive/trash, drafts, and sending |
| `full` | `mail` plus account add/remove and permanent deletion |

If the variable is omitted, the server defaults to `mail`.

Unknown values fail closed during MCP initialization. Unknown future tool names are not automatically exposed by any permission mode.

Cloudflare Access remains the authentication boundary. `MCP_PERMISSION_MODE` is a deployment-level safety boundary, not a multi-tenant RBAC system.

## Web management UI

The existing management UI remains intentionally small: Gmail, iCloud, Outlook, and Custom. Choose Custom for any other provider and enter its IMAP/SMTP settings manually.

Accounts created through MCP can still be edited in the Web UI. Provider metadata and a separate login username are preserved when the legacy form saves an account.

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
