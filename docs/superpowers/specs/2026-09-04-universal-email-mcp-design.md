# Universal Email MCP Design

## Goal

Evolve the existing Cloudflare Workers email MCP into a production-oriented Universal Email MCP without replacing its working architecture. Any standards-compliant mailbox should remain usable through explicit IMAP/SMTP settings, while common providers gain safe presets and automatic detection.

## Constraints

- Keep Cloudflare Workers, `cloudflare:sockets`, Hono, Workers KV, AES-256-GCM credential storage, Cloudflare Access, the MCP SDK, and the existing MailService.
- Keep custom IMAP/SMTP as the permanent escape hatch.
- Do not add a database, queue, proxy service, or provider-specific mail service hierarchy.
- Preserve existing stored account compatibility.
- Prefer additive, backward-compatible changes.

## Phase 1: Universal foundation

### Provider registry

Add a pure provider registry with stable presets for common providers. A provider preset contains an id, label, matching domains, default IMAP/SMTP configuration, authentication style, and a short credential hint.

Automatic detection uses the email domain. Explicit provider selection overrides domain detection so custom domains hosted by Fastmail/Zoho/etc. can still reuse presets. Unknown providers require an explicit IMAP host and continue to work as custom IMAP/SMTP accounts.

Initial presets:

- Gmail
- Outlook/Hotmail/Live
- iCloud
- NetEase 163
- NetEase 126
- NetEase Yeah
- QQ Mail / Foxmail
- Fastmail
- Yahoo Mail
- Zoho Mail

### Account identity

Add optional `username` and `provider` fields to `MailAccount`.

- `username` is the IMAP/SMTP authentication username and defaults to the account email for old and new accounts.
- `provider` is metadata only and does not control protocol behavior once account settings are stored.

This removes the current assumption that the login username must always equal the mailbox address.

### MCP account creation

`email_add_account` accepts an optional `provider` and optional IMAP/SMTP settings.

- Known provider + omitted host values -> fill from preset.
- Unknown provider + omitted IMAP host -> reject with a clear error.
- `smtpEnabled: false` -> create a read-only account even when the provider has SMTP defaults.
- Explicit host/port/TLS values override preset values.

### Management UI

Reuse the same provider registry to render provider choices and browser-side presets. Do not maintain a second hard-coded provider table in `app.ts`.

### Permission modes

Add deployment-level `MCP_PERMISSION_MODE` with:

- `read`: register read-only MCP tools only.
- `mail` (default): allow normal mailbox operations, drafts and sending, but block account configuration/removal and permanent deletion.
- `full`: register all tools.

Cloudflare Access remains the authentication boundary. Permission mode is a deployment safety boundary, not multi-tenant RBAC.

### Testing

New pure logic is test-first and runs without Cloudflare runtime dependencies:

- provider detection and explicit selection
- server resolution/override behavior
- custom provider fallback errors
- permission mode parsing and tool filtering

Existing tests remain unchanged.

## Later phases

- Gmail OAuth onboarding using the existing Outlook flow as the second concrete implementation before extracting shared OAuth helpers.
- SMTP delivery-state hardening (`not_sent`, `sent`, `sent_but_save_failed`, `unknown_delivery_state`).
- More protocol/parser and live smoke tests against dedicated test mailboxes.
- Provider compatibility fixes only when a real provider demonstrates a protocol difference.
