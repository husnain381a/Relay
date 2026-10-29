# Testing Relay

## What has actually run

The initial local unit and service-boundary suites cover idempotent reconciliation, late acknowledgements, ordering, offline recovery beyond one page, old edits/deletions/reactions, body/UUID/file validation, safe auth redirects, cookie-endpoint CSRF and streamed size limits. Authenticated presence expiry and recipient-relative DM names have dedicated unit tests. Run `npm test` for the current exact test count and result.

The 2026-10-29 continuation adds collection range/sentinel tests, a full saved identifier scan beyond 1,000 records (including a simulated server cap of 137 rows), failed later-page handling, stale request suppression, independent collection request ownership, and draft/thread RPC validation. Collection pages now expose load-more for saved items, scheduled messages, files, activity and followed threads. Search paginates both files and messages. Unit fixtures exercise these service boundaries; they do not replace authenticated UI checks against Supabase Cloud. Thread subscriptions, thread read cursors, durable drafts and private profile media also require applying all continuation migrations before using the new UI.

`npm run test:db` executes the actual migrations in an isolated PostgreSQL-compatible PGlite database with representative Supabase auth/storage/realtime schemas. It tests real SQL constraints, privileges, RLS and RPCs under distinct database roles. Supabase platform internals are stubbed in this harness: passing these tests does not establish that managed Auth, Storage HTTP, WAL replication or WebSocket authorization works in Supabase Cloud.

The authenticated Playwright suite and load exercise are included but have **not run against a real Supabase project** in this session. The dedicated Relay project is now migrated and connected. Five public-key hosted smoke checks pass; authenticated test accounts have not been supplied. Never describe gated/skipped tests as a passing end-to-end product validation.

## Commands

The workspace-startup relationship fix has 10 explicit hosted PostgREST checks: the former saved-message embed reproduces PGRST201, and nine actual service query paths resolve their explicit foreign-key joins before correctly denying anonymous reads. These checks create no users or application records and do not claim authenticated journey coverage. Run with the configured project's public key:

```powershell
$env:RELAY_VERIFY_HOSTED_QUERIES='1'
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/postgrest-relationships.test.ts
Remove-Item Env:RELAY_VERIFY_HOSTED_QUERIES
```

They are skipped in ordinary `npm test`; the opt-in run against relay-web passed all ten.

```text
npm ci
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
npm --prefix desktop test
```

The default browser checks exercise the public setup/login state. The real-backend suite skips explicitly until its required settings are present. The configured browser is Microsoft Edge (`channel: msedge`); install Edge or run `npx playwright install msedge` on a fresh machine. CI uses an isolated runner and test secrets; never commit those secrets.

## Real-backend browser acceptance

Create a **dedicated test Supabase project**, apply every migration in order, disable public Realtime channels, configure the application's URL and redirects, and create two confirmed test accounts through Auth. A third confirmed account enables additional outside-workspace isolation assertions. The suite never provisions users, disables email confirmation or uses privileged credentials.

Set these environment variables in the current shell/CI secret store:

| Variable | Purpose |
| --- | --- |
| `TEST_SUPABASE_URL` | Dedicated project's API URL |
| `TEST_SUPABASE_KEY` | Publishable key (legacy anon accepted; service-role/secret keys rejected) |
| `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD` | Existing owner test account |
| `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD` | Existing second test account |
| `TEST_USER_C_EMAIL`, `TEST_USER_C_PASSWORD` | Optional outside-workspace test account |
| `TEST_ALLOW_WRITES` | Literal `true`, explicitly permitting test fixture writes |

The Playwright web server must build/run with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` mapped to the same test values. An already running server compiled against a different project must not be reused. The test runner config supplies this mapping when configured; stop an old local server first if its port conflicts.

Run `npm run test:e2e -- tests/e2e/real-backend.spec.ts`. It uses two independent browser contexts and real Auth, PostgREST, private Broadcast and Storage connections; it never intercepts or mocks network requests. It covers:

- Workspace creation and hashed invitation onboarding through the UI.
- Persisted sends and UUID replay deduplication.
- Peer visibility over WebSockets without a refresh, edits, emoji reactions and thread replies.
- Saved messages and authorized indexed search through the UI.
- Document upload and downloading a real signed URL.
- Private channel read/write/edit/subscription denial, denied file signing, granted/revoked membership, direct-message deduplication, and rejection of forged presence rows.
- Optional third-user workspace/DM/content isolation.
- Persisted catch-up after one browser goes offline and reconnects.

The fixture creates a uniquely named `[e2e]` workspace and test messages. Its uploaded objects are removed at teardown. Workspace/message metadata is retained in the dedicated test project for inspection; remove that workspace through trusted administration after reviewing failures. Never run this suite against a production project or real employee accounts. Password-bearing login traces and videos are disabled. No storage-state/session token files are written.

## Load-test budgets

The initial targets are p95 send persistence acknowledgement <800 ms and p95 authorized peer visibility <1.5 s, measured at the expected geography/concurrency. They are unverified targets, not published SLOs.

`scripts/load-test.mjs` is an opt-in bounded workload using the installed Supabase SDK. It does not run as part of ordinary tests and creates no accounts. Each account must already belong to a dedicated target channel. Set `TEST_SUPABASE_URL`, `TEST_SUPABASE_KEY`, `LOAD_CONVERSATION_ID`, `LOAD_USERS_JSON` (an array of `{email,password}` objects from the secret store), and `LOAD_ALLOW_WRITES` equal to the **exact project hostname**. Optional `LOAD_DURATION_SECONDS` (5–120, default 30) and `LOAD_RPS` (global rate ≤10, default 2) bound the workload. Up to 200 supplied accounts are supported.

Run `node scripts/load-test.mjs`. It joins private channels, sends persisted UUID messages, re-reads peer notifications through RLS, reports p50/p95 acknowledgement and visibility latency, checks missing peer deliveries and exits nonzero if a budget fails. It never logs credentials. `[load]` records remain in the test project. A single generator does not validate geographic latency, production scale, backups, outages or the user's browser rendering budget.

Before launch, run a representative 100-user/10-messages-per-second scenario and review database CPU, query plans, Realtime quotas/errors and browser performance. Use additional regions/runners for geographic coverage. Record measured results and infrastructure size before setting contractual SLOs.

## Remaining release checks

Managed Supabase Auth redirects/SMTP/password recovery; real private subscription rejection and revocation; signed URL expiry; concurrent invite redemption; offline send/retry across browser restarts; mobile and keyboard flows with actual records; screen reader review; query plans at production data size; backup restoration; scheduled dispatcher and failure monitoring; desktop installation, deep links, keychain encryption, signed updates and rollback. Source code or a successful build alone does not close these gates.
