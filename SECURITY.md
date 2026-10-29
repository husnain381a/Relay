# Security of Relay's web application

Relay's current release target is the web application and installable PWA. Native EXE builds and publication are deferred. Installer files, credentials and environment files are excluded from Git.

## Message confidentiality and authorization

Messages use Supabase Auth and PostgreSQL row-level authorization. They are **not end-to-end encrypted**: message bodies and their search indexes are readable by authorized database/project administrators. Supabase documents encryption at rest and TLS in transit; the deployed web origin must also use HTTPS. Do not describe this design as zero-knowledge or as preventing server administrators from reading messages.

- Every public application table has RLS; anonymous roles have no application table grants.
- Workspace membership gates tenant access. Private channels and DMs require participation.
- Server endpoints verify users with getUser. RPCs independently authorize their caller; public wrappers do not use SECURITY DEFINER.
- Authors and permitted administrators control message changes; callers cannot forge authors or promote themselves.
- Private Realtime broadcasts contain identifiers, not message bodies. Bodies are reread through RLS. Membership removal rotates topic epochs.
- Markdown raw HTML is explicitly dropped, unsafe URL protocols are blocked by the renderer, and external images are not loaded.
- CSP, frame restrictions, same-origin mutation checks, input/stream size limits, request IDs and rate limits provide additional controls. HTTPS responses include HSTS without preload or subdomain expansion.

## Files and browser storage

Both Storage buckets are private. Signed file links last 60 seconds and require authorized access when issued. New attachment/profile uploads request zero cache lifetime rather than retaining a one-hour attachment cache. This change does not rewrite metadata on previously uploaded files.

The PWA worker caches only its public offline screen and icons. It does not cache conversations, application HTML, API/Auth responses, files or signed URLs. Existing text drafts remain user-scoped browser/session/database data; an already loaded conversation may remain in memory. Using a shared device still requires signing out and protecting the browser profile.

An authorized recipient can copy or download content. Already downloaded files cannot be revoked; a previously issued link can work until its TTL expires. Malware scanning and aggregate storage-retention automation remain release work.

## Checked 2026-10-29

- Hosted catalog: zero public product tables without RLS, zero anonymous application grants, zero public buckets and zero public SECURITY DEFINER functions.
- Hosted public-key checks: Auth/email confirmation, anonymous tenant-read denial, anonymous mutation denial and private-topic denial pass.
- Local PostgreSQL harness: 45 cross-tenant/private/DM/message/file/role/revocation checks pass, with Supabase platform interfaces shimmed.
- Service tests: 104 pass, including private attachment transfer boundaries. These are not a substitute for real-user hosted tests.
- History/staged-source pattern scan: no credential or installer findings before publication. The scanner is heuristic and cannot prove absence of every possible secret.

## Remaining deployment controls

1. **Disable Allow public access in [Realtime settings](https://supabase.com/dashboard/project/qiidmrxekvdqjfeoqhgt/realtime/settings).** The latest probe still allowed an anonymous public channel. Relay's own traffic uses private topics, but this broader platform setting remains open.
2. The hosted advisor reports **leaked-password protection disabled**. Supabase offers this on Pro and above; no paid upgrade was authorized or performed. The app requires 12-character new passwords, but that client validation does not replace server-side password policy. Set the server policy in Auth settings.
3. Configure exact HTTPS Auth callback URLs, production SMTP, monitoring, backups, retention and incident handling. Check two real users across separate workspaces/private channels, files, reconnect and removal. Authenticated hosted journeys and real-device installation remain unverified.
4. Review active-token/session lifetime and managed-service privileges. Existing JWTs and signed links have independent expiry behavior.

The current connector can inspect the project and SQL but cannot update the listed Auth/Realtime settings. The installed CLI's account does not have access to this Relay project. Do not substitute an unrelated project's credentials or disable authentication to bypass this.

For a vulnerability, use GitHub's private vulnerability reporting if enabled by the repository owner. Do not post tokens, private messages or uploaded files in public issues.

References: [Supabase data protection](https://supabase.com/security), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [private Realtime](https://supabase.com/docs/guides/realtime/authorization), [password protection and plan availability](https://supabase.com/docs/guides/auth/password-security).
