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

Add a pure provider registry with stable presets for common providers. A provider preset contains an id, label, matching domains, default IMAP/SMTP configuration, and a short credential hint.

Automatic detection uses the email domain. Explicit provider selection overrides domain detection so custom domains hosted by Fastmail/Zoho/etc. can still reuse presets. Unknown providers require an explicit IMAP host and continue to work as custom IMAP/SMTP accounts.

Initial presets:

- Gmail
- Outlook/Hotmail/Live
- iCloud
- NetEase 163 / 126 / 188 / yeah.net, including VIP variants
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
- Explicit provider IDs are normalized before lookup.

### Management UI

Keep the existing management UI intentionally small in phase 1. Gmail, iCloud, Outlook, and Custom remain available there; every other standards-compliant provider can be configured through Custom. Provider presets are exposed through MCP account creation instead of duplicating a second provider table inside the large legacy `app.ts` file.

If the Web UI later needs first-class buttons for every provider, render them from the shared provider registry rather than creating another hard-coded table.

### Provider-specific protocol compatibility

Protocol differences are handled only when backed by a real provider requirement. NetEase IMAP hosts send RFC 2971 `ID` after authentication and before mailbox selection when the server advertises the `ID` capability, preventing the documented `SELECT Unsafe Login` failure without affecting other providers.

### OAuth refresh boundary

The native IMAP/SMTP transports can use a supplied XOAUTH2 access token for any compatible provider, but the existing automatic refresh implementation is Microsoft-specific. Refresh is therefore entered only for accounts explicitly marked as Outlook or legacy accounts using `outlook.office365.com`. Non-Outlook refresh tokens and client IDs are never sent to the Microsoft token endpoint. Provider-specific onboarding and refresh are deferred until each provider has a concrete implementation.

### Permission modes

Add deployment-level `MCP_PERMISSION_MODE` with:

- `read`: register read-only MCP tools only.
- `mail` (default): allow normal mailbox operations, drafts and sending, but block account configuration/removal and permanent deletion.
- `full`: register all tools.

Cloudflare Access remains the authentication boundary. Permission mode is a deployment safety boundary, not multi-tenant RBAC.

### SMTP ambiguity guard

After the SMTP DATA payload has been transmitted, an explicit non-success SMTP response remains a definite failure. A transport failure while waiting for the final SMTP response is classified as an unknown delivery state with an explicit "do not retry automatically" error. Because `sendDraft` stops at that error, it does not append a Sent copy or delete the original draft.

### Testing

New pure logic is test-first and runs without Cloudflare runtime dependencies:

- provider detection and explicit selection
- server resolution/override behavior
- custom provider fallback errors
- NetEase host detection
- Outlook-only Microsoft OAuth refresh routing
- account login identity compatibility
- permission mode parsing and tool filtering
- SMTP post-DATA failure classification

Existing tests remain unchanged.

## Later phases

- Gmail interactive OAuth onboarding and Google-specific token refresh, using the existing Outlook flow as the second concrete implementation before extracting only proven shared OAuth helpers.
- Rich structured SMTP delivery states (`not_sent`, `sent`, `sent_but_save_failed`, `unknown_delivery_state`) if clients need machine-readable reconciliation beyond the current fail-closed error.
- More protocol/parser and live smoke tests against dedicated test mailboxes.
- First-class Web UI provider buttons only if the Custom flow proves insufficient.
