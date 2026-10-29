# Deploying Relay

This is a release runbook, not evidence of a completed deployment. Read `docs/STATUS.md` for actual execution results and open gates. Cloud infrastructure is not provisioned by these files. There is no automatic deployment or unsigned-desktop publishing job in CI.

## Environment boundaries

Use a dedicated Supabase project for each environment. Never point development fixtures, RLS tests, or load tests at production. Do not reuse the unrelated existing project to bypass project quotas. Resolve organization quota/billing and confirm the target project before applying migrations. No production sample users, conversations, or messages are needed.

| Variable | Where | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Build and server runtime | Dedicated project's HTTPS API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Build and server runtime | Public publishable key protected by database/storage policies |
| `NEXT_PUBLIC_APP_URL` | Build and server runtime | Canonical HTTPS application origin |
| `CRON_SECRET` | Server runtime only | Random scheduler bearer secret of at least 32 characters |
| `SUPABASE_SECRET_KEY` | Server runtime only | Privileged key used only by the scheduled-message dispatcher |
| Sentry configuration | Pending implementation | SDK instrumentation and verified alert delivery must be added before claiming Sentry monitoring |

Next.js embeds `NEXT_PUBLIC_*` values into browser bundles during the build. Set them before compiling, and rebuild when changing the backend or canonical origin. Runtime values must match the build. Never use a service-role/secret key in a public variable. Do not bake server secrets into Docker arguments, image layers, source archives, desktop configuration, logs, or test artifacts.

## Database and authorization

1. Inspect the dedicated project's existing tables, migrations and advisors. Confirm the target reference with the owner.
2. Review the ordered SQL under `supabase/migrations/` and run `npm run test:db`. PGlite executes PostgreSQL semantics with test-only Auth/Storage/Realtime shims; passing it does not validate hosted infrastructure.
3. Use the installed Supabase CLI's `--help` to verify the current `link`, `migration list`, and `db push` commands, or apply the reviewed migrations through the authorized Supabase connection. Verify the target before each write. Apply every migration in filename order and record the resulting migration history.
4. Confirm all product tables have RLS, the `private` schema is not exposed through the Data API, public RPC wrappers have the expected grants, and no anonymous role can read tenant data. Run Supabase security and performance advisors; investigate rather than silently suppress findings.
5. Confirm the `attachments` bucket is private and retains its migration-defined MIME allowlist and 10 MiB object limit. Confirm authenticated storage policies and signed URL access against two real users.
6. In Realtime settings, **disable “Allow public access to channels.”** Keep Realtime enabled. Relay uses private authorization policies and identifier-only database invalidations. Changing these settings disconnects clients; perform the change before launch and verify reconnect behavior.
7. Verify the notification table's publication and private `conversation:`, `workspace:` and `user:` topics. An ordinary workspace member must fail to join another workspace's topic or another user's topic. A same-workspace nonparticipant must fail to join a private conversation. A removed member's reads must fail; the old topic must receive only its empty rekey control and no subsequent activity after rotation.

No seed script belongs in the production deployment. The first real user signs up and creates the first workspace through the application.

## Supabase authentication and email

Set Auth's Site URL to the canonical HTTPS app origin. Allow the exact production `/auth/callback` and `/auth/confirm` URLs and any deliberately approved staging redirect URLs. Avoid wildcard redirects across untrusted preview domains. Local password tests use `http://127.0.0.1:3000`; add local redirects only in development/staging projects.

Configure a production SMTP provider, verified sender/domain, SPF/DKIM and appropriate DMARC, delivery limits and abuse controls. Test signup confirmation, password reset, expired links, reused links and session revocation with real test mailboxes. The default development mail service is not a production email plan. Workspace invitation links are copied by the application; email delivery of workspace invitations is not implemented.

The application supports a PKCE callback at `/auth/callback?code=...` and token-hash verification at `/auth/confirm`. Where using customized email templates, point confirmation links to the latter with `token_hash`, the appropriate Supabase email OTP `type`, and a safe relative `next` value. For example, confirmation can use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; password recovery can use `type=recovery&next=/auth/reset`. Verify the template with the configured Auth flow before launch. Never write token hashes into analytics or logs.

Keep Auth JWT lifetime appropriately short for the intended revocation window. Removing a member immediately changes database RLS; existing JWTs, private-channel authorization caches and already issued signed URLs have separate expiry behavior. See `docs/OPERATIONS.md`.

## Vercel

Create a Next.js project rooted at this repository, select Node.js 24, and use `npm ci --ignore-scripts` as the install command and `npm run build` as the build command. Keep development, preview and production environment variables separate. Add the public configuration above before the first build. Add server-only scheduling secrets only when enabling the dispatcher.

Deploy a staging build first. Add the final HTTPS domain, update `NEXT_PUBLIC_APP_URL`, update Supabase Auth URLs, and rebuild. Verify TLS, secure cookie behavior, cache-control headers and `GET /api/health`. This endpoint checks configuration and Supabase Auth reachability; it is not a full database/Realtime readiness guarantee. `GET /api/health/live` reports process liveness.

Run two-user authenticated checks on the deployed origin: onboarding, invitation, public/private channels, DMs, persistence, edits/deletion/reactions/threads, uploads, authorization denial, reconnect, search and notifications. Verify HTTPS/WSS connectivity and mobile layouts. The browser test harness defaults to localhost; a hosted-origin run requires deliberately configuring its base URL and server lifecycle first. Do not claim deployment validation from a local build or liveness response alone.

## Scheduled messages

Scheduling a row does not execute it. The route `GET /api/cron/scheduled` requires `Authorization: Bearer <CRON_SECRET>` with a matching secret of at least 32 characters. It also requires server-only `SUPABASE_SECRET_KEY`. The route calls the service-only `process_scheduled_messages()` RPC; the database rechecks access and processes at most 100 due rows per call. Scheduling is not operational until a real scheduler is configured and verified.

For Vercel, add a cron entry to your reviewed `vercel.json` after checking that the chosen plan supports the required frequency:

```json
{
  "crons": [
    { "path": "/api/cron/scheduled", "schedule": "* * * * *" }
  ]
}
```

Vercel attaches `CRON_SECRET` as a bearer header. Redeploy, check the scheduler's actual enabled state, and inspect successful invocations. No `vercel.json` cron is pre-enabled in this repository. Alternatively, an authorized database owner can configure pg_cron/pg_net as described below. Do not enable both schedulers by accident.

Test one due message, a future message, retries/overlapping invocations, a removed sender, an archived conversation, and a missing/incorrect bearer header. Verify `401` for unauthorized calls, no public caching, persisted final message IDs and no duplicate sends. Monitor oldest due-row age; a healthy route alone does not prove scheduled jobs are running.

### Optional database-owner cron configuration

This is an **operator-run example**, not a migration and not executed during development. A database owner must first approve and enable `pg_cron`, `pg_net` and Supabase Vault, confirm the deployed origin, and place the app's canonical HTTPS origin and scheduler bearer secret in Vault as `relay_app_origin` and `relay_cron_secret`. Enter the secret through a secure administrative session; never commit a literal value or copy it into issue/CI logs. The scheduler uses the app's bearer secret, not the public publishable key.

```sql
-- Run only in the approved dedicated project after extensions and Vault entries exist.
-- Check cron.job for this name before scheduling; do not create duplicates.
select cron.schedule(
  'relay-scheduled-message-dispatch',
  '* * * * *',
  $relay_job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'relay_app_origin') || '/api/cron/scheduled',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets
           where name = 'relay_cron_secret')
      ),
      timeout_milliseconds := 10000
    );
  $relay_job$
);
```

The Vault origin should have no trailing slash. Review both `cron.job_run_details` and the HTTP response records: pg_cron success can mean the asynchronous request was queued, not that the web dispatcher returned success. Access to pg_net request/response metadata must remain administrative. Record the job ID for controlled disabling with `cron.unschedule` and rotate the Vault secret alongside the web runtime secret.

## Self-hosted container alternative

`Dockerfile` uses Node 24 Debian slim, locked dependencies, a Next.js standalone build, and a non-root runtime. Public config is supplied at build time; privileged config is supplied only at runtime. `.dockerignore` excludes secrets, desktop binaries, local caches and development artifacts. Pin an approved base-image digest and scan the resulting image for the actual release.

Example with public values only:

```sh
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY \
  --build-arg NEXT_PUBLIC_APP_URL=https://YOUR_RELAY_DOMAIN \
  -t relay:release .
docker run --rm -p 127.0.0.1:3000:3000 --env-file /secure/runtime.env relay:release
```

The protected runtime environment file must repeat the same public values and contain server secrets only if scheduling is enabled. Mount/inject it through the hosting platform's secret manager where possible. Put an HTTPS reverse proxy in front of the container, restrict exposed ports, preserve correct origin/host headers, configure request-body limits for attachments and authentication throttling, and keep Supabase HTTPS/WSS egress available. Do not publicly expose development servers.

Docker is not installed in the development environment, so this container has not been built or run here. Its standalone paths were checked against the project configuration; a real image build, startup/readiness checks and authenticated container smoke test remain release gates.

## CI and final promotion

PWA assets and standalone preparation are documented in [PWA.md](PWA.md). Serve the final app over HTTPS, preserve the `/sw.js` no-store headers and root scope, and include all public icons and the offline page. CI runs the production PWA suite before the development browser suite; native OS and iPhone/Safari installation still need validation on the deployed origin.

`.github/workflows/ci.yml` checks type generation/typecheck, unit tests, PGlite authorization tests, production build, setup/responsive/keyboard browser tests using the Windows runner's installed Edge, and desktop source tests. Official action references are pinned to verified commit hashes. Pull requests receive no deployment or backend-test secrets.

The `cloud-integration` job runs only through `workflow_dispatch` with `run_cloud_tests=true` and an `integration` environment containing `TEST_SUPABASE_URL`, a **publishable** `TEST_SUPABASE_KEY`, and two existing test accounts (`TEST_USER_A_EMAIL/PASSWORD`, `TEST_USER_B_EMAIL/PASSWORD`). A third account is optional. Protect that environment with required reviewers. This explicit run creates `[e2e]` workspaces/messages in the dedicated backend and leaves the workspace for failure inspection; it never provisions or deletes user accounts. Authenticated traces and sessions are not uploaded.

The workflow has not been run in GitHub during local development; local results are recorded separately. A skipped cloud suite is not a passed cloud suite. Promote only after the target environment's real authorization, real-time, SMTP, scheduling, backup, monitoring and load-test gates pass. Follow `docs/DESKTOP.md` for the separate signed Windows release.

References checked: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Supabase Realtime settings](https://supabase.com/docs/guides/realtime/settings), [Supabase scheduled invocation](https://supabase.com/docs/guides/functions/schedule-functions), [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
