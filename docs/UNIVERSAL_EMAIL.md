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

`email_add_account` is registered only in `MCP_PERMISSION_MODE=full`. The default `mail` mode intentionally keeps account administration out of the MCP tool surface; use the Web management UI for account setup when staying on the default mode.

Prefer the Web management UI for real mailbox credentials. Credentials entered through `email_add_account` pass through the MCP client/model workflow before the Worker encrypts and stores them; the Web UI submits them directly to the Worker instead.

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

## NetEase IMAP compatibility

NetEase IMAP servers require RFC 2971 client identification on affected mailboxes before selecting folders. The Worker automatically sends an `ID` command after authentication for the built-in NetEase IMAP hosts when the server advertises the `ID` capability.

This behavior is based on the actual IMAP host, not the stored provider name. A NetEase account entered through the Web UI as Custom therefore receives the same compatibility handshake when its IMAP host is `imap.163.com`, `imap.126.com`, `imap.yeah.net`, or one of the supported NetEase VIP/188 hosts.

## Credentials and OAuth

Credentials are encrypted with the existing AES-256-GCM account store before being written to Workers KV. Do not put mailbox passwords, app passwords, authorization codes, OAuth tokens, or `CREDENTIAL_ENCRYPTION_KEY` in Git.

For NetEase and QQ Mail, use the provider-issued client authorization code rather than the normal web-login password where the provider requires it.

The native IMAP/SMTP clients can authenticate with a supplied XOAUTH2 access token. Automatic refresh is currently implemented only for the standard Outlook/Microsoft IMAP endpoint. Microsoft refresh is entered only when the stored IMAP host is actually `outlook.office365.com`; the provider label is deliberately not trusted because it can become stale after explicit server overrides or later account edits. Gmail and custom OAuth credentials are therefore never sent to the Microsoft token endpoint merely because of provider metadata. For non-Outlook providers, supply a currently valid access token or use the provider's app-password/authorization-code flow until provider-specific OAuth onboarding and refresh support is implemented.

## MCP permission modes

`MCP_PERMISSION_MODE` controls which tools are registered with MCP clients.

| Mode   | Behavior                                                          |
| ------ | ----------------------------------------------------------------- |
| `read` | Read/search/status/attachments only                               |
| `mail` | Default. Read plus flags, move/archive/trash, drafts, and sending |
| `full` | `mail` plus account add/remove and permanent deletion             |

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
- If the connection fails after the SMTP DATA payload was transmitted but before the final server response is known, the send fails with an explicit unknown-delivery-state error. Do not retry automatically. The draft is preserved and no Sent copy is appended by this send attempt.
