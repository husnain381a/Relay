# Connected Relay backend

Configured on 2026-10-29 (Asia/Karachi) through the user-selected **Relay** Supabase connection.

- Organization: Relay (`jhpgtwptsgqpfncuqwdb`).
- Project: relay-web (`qiidmrxekvdqjfeoqhgt`), eu-west-1.
- API: https://qiidmrxekvdqjfeoqhgt.supabase.co
- Local application: http://127.0.0.1:3000
- Public connection settings are in Git-ignored `.env.local`. No secret/service-role key was retrieved or stored.
- All eight source migrations have been applied. The eighth adds the six missing foreign-key indexes reported by the hosted advisor.
- All 17 public application tables have RLS. Anonymous roles have no application table grants. Public RPCs do not use SECURITY DEFINER.
- Attachments and profile-media buckets are private, with respective 10 MiB and 2 MiB object limits.
- No users, workspaces, messages or files were seeded.

## Verified

Production build passes with the configured project. All 45 local SQL groups pass across eight migrations. Hosted Auth returns HTTP 200; email authentication is enabled and email confirmation remains required. Anonymous message reads and workspace creation return HTTP 401. Anonymous private Realtime subscription receives an explicit CHANNEL_ERROR. These checks do not replace authenticated multi-user/Storage tests.

Hosted security advisor: no warnings/errors. The informational no-policy finding for `private.rate_limits` is intentional: direct access is denied and only authorized private helpers use it. Performance advisor: missing-FK findings fixed; unused-index notices are expected in this empty project. See [security advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Dashboard settings still required

The plugin does not expose Auth/Realtime settings changes. Browser automation stopped because it could not determine the browser URL reliably, so these settings were not changed.

1. In [Realtime settings](https://supabase.com/dashboard/project/qiidmrxekvdqjfeoqhgt/realtime/settings), disable **Allow public access**. The hosted anonymous public-channel probe confirmed it is currently enabled. Relay itself subscribes only to private channels; its database broadcasts are private.
2. In [Auth URL configuration](https://supabase.com/dashboard/project/qiidmrxekvdqjfeoqhgt/auth/url-configuration), set the local Site URL to `http://127.0.0.1:3000` and allow exactly `http://127.0.0.1:3000/auth/callback` and `http://127.0.0.1:3000/auth/confirm`. Replace/add the final HTTPS origin when deployed.
3. Keep email confirmation enabled. Configure production SMTP before inviting real users.

Recheck connectivity after changing settings:

```powershell
node --env-file=.env.local scripts/verify-backend.mjs
```

The report should show `publicChannelsAllowed: false` with an explicit denial, not a network timeout.

## Migration history

Supabase's MCP migration API assigned server-side timestamps different from the original CLI-generated local filenames. See `docs/verification/supabase-project.json` for local-file-to-hosted-name mapping and `supabase-migrations.json` for actual hosted versions. Do not blindly run `supabase db push` against this project: reconcile the migration history using the current CLI's documented migration-repair workflow first. Do not reapply the initial schema.

Deployment, authenticated multi-user validation, SMTP, automatic scheduling, and signed desktop releases remain separate release gates. The existing desktop validation installer still shows setup until a deployed HTTPS app origin is provided.

Native EXE packaging is now deferred at the user's request; the current target is the web/PWA. The latest security review and actual open settings are in ../SECURITY.md.
