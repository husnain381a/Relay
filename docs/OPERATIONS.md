# Operating Relay

These procedures define the work needed for a production service. They do not establish an uptime guarantee, a measured capacity, configured monitoring or a proven recovery time. Record each exercise's date, environment, commit, operator and evidence in the release record.

## Service health and observability

`GET /api/health/live` confirms the Next.js process responds. `GET /api/health` checks public configuration and Supabase Auth reachability with a three-second timeout. Neither endpoint proves a user's RLS permissions, message persistence, private-channel subscription, storage download, SMTP delivery or scheduled dispatch.

Monitor liveness/readiness separately from an authenticated synthetic workflow in a dedicated tenant. The synthetic should send a uniquely identified message, verify a second authorized session can retrieve it, verify an outsider cannot, and remove test content according to the agreed retention policy. Never monitor by repeatedly writing into customer conversations. Check websocket connectivity separately from HTTP success.

Server API failures emit structured events with request ID, status/code and elapsed time. Do not add message text, filenames, passwords, invitation tokens, auth URLs, session cookies, signed URLs, bearer headers or secret keys to logs. Configure log retention, administrative access, alert routing and a support procedure using request IDs. `NEXT_PUBLIC_SENTRY_DSN` is a reserved template field; no Sentry SDK instrumentation is currently installed. A real error sink, privacy filtering and a test alert are release requirements.

Useful alerts include sustained send failures/latency, Realtime subscription errors, unexpected RLS/permission denials, Auth failure spikes, database CPU/connections/storage/slow queries, Storage egress and aggregate usage, scheduler errors and due-row age, and backup failures. Route alerts to a real on-call owner and test that route. Set thresholds after obtaining baseline measurements.

## Performance acceptance targets

| Measurement | Initial target | Validation needed |
| --- | --- | --- |
| Persisted send acknowledgement | p95 below 800 ms in one region | Real authenticated send measurements |
| Connected peer visibility | p95 below 1.5 seconds | Second-user delivery followed by RLS read |
| Initial concurrency exercise | 100 concurrent users, 10 messages/second globally | Dedicated backend, quotas and test users prepared |
| History loading | 50 messages per page | Query plan and browser memory/DOM profiling |
| Attachment | At most 10 MiB per object | Hosted MIME, authorization and size enforcement |
| Message DOM | Virtualized/bounded | Long-history browser profiling |

These are targets from `ARCHITECTURE.md`, not measured production results. Sequence numbers can have gaps and do not guarantee commit ordering. A database acknowledgement does not mean all peers have seen the message. Reconnects re-read persisted content and reconcile IDs; investigate missing history through authorized database reads before treating broadcast loss as data loss.

`scripts/load-test.mjs` is an opt-in real-backend exercise. It refuses to run without a specific `LOAD_CONVERSATION_ID`, existing dedicated accounts supplied through protected `LOAD_USERS_JSON`, a publishable test key, and `LOAD_ALLOW_WRITES` matching the exact test project's hostname. It allows 2–200 accounts, 5–120 seconds and at most 10 global messages/second; it leaves `[load]` records in the test project. Never put account JSON/passwords into command arguments, shell history, logs or the repository. Provision test accounts/membership through authorized setup before invoking it. It reports p50/p95 acknowledgements and authorized peer observations and exits nonzero when its budgets fail. Its single load-generator host does not measure worldwide latency, long-duration soak, reconnect storms or uptime.

Start at low volume, inspect provider quotas/costs, then increase to the planned exercise. Investigate latency with database query plans, index usage, connection pools, Realtime authorization pool saturation and event fan-out. Add Redis or a dedicated socket tier only after evidence identifies a bottleneck and its operational costs are understood.

## Backups and recovery

Adopt and fund recovery objectives before accepting business-critical data. Provisional planning targets are a database RPO of at most one hour and RTO of at most four hours, and object-storage RPO/RTO of at most 24 hours. These are **unverified targets**, not delivered guarantees. A daily backup alone cannot satisfy a one-hour database RPO. Select an appropriate PITR/export policy and verify its costs and available retention for the chosen plan.

Supabase database backups contain Storage metadata, not the object bytes. Maintain an independent encrypted object backup/versioning policy, a manifest of object paths/checksums and an access-controlled off-site copy. A database restore cannot recreate a previously deleted file. Free-tier projects require an explicit backup/export plan; do not assume paid-tier backup retention exists. Keep migrations and release artifacts separately from data backups. See [Supabase's backup scope and plan documentation](https://supabase.com/docs/guides/platform/backups).

Run a restore drill into an isolated, approved project before launch and after material schema changes:

1. Record the backup timestamp, target recovery point, migration version and object manifest. Disable outbound email, production cron jobs and external integrations in the restore target.
2. Restore through the supported platform process. Restore object bytes through Storage APIs and reconcile them with restored attachment metadata. Do not write internal storage tables as a replacement for object restoration.
3. Reapply environment-specific Auth URLs, RLS/grants, Realtime settings and server secrets as required. Verify the target cannot communicate with production clients or scheduled workers.
4. Validate row counts and representative checksums; sign in controlled users and verify workspace isolation, private DMs, threads, search, file signatures and denied outsider access. Run a real two-user message/reconnect exercise.
5. Measure actual recovery point and elapsed recovery time. Document missing objects, irreversible gaps and corrective work. Rehearse DNS/app configuration rollback and only then approve the runbook.

Restores, project deletion and DNS cutovers are controlled operator actions. Never automatically restore over production from CI. A failed restore drill blocks any claim that the recovery objectives have been met.

## Data retention and object cleanup

Soft-deleting a message hides it and its linked files through policy, but does not guarantee immediate physical erasure. Deleting channels or interrupted uploads can leave stored objects. No aggregate storage quota, automated orphan sweeper or full retention/export/erasure workflow is currently implemented. Provider quotas, abuse controls and an explicit retention policy are required before public signup at scale.

Implement the cleanup worker only after reviewing the policy and its authority. First produce a dry-run inventory of aged unlinked objects, deleted-message/channel attachments and expired staged uploads. Compare against live attachment references, current legal/retention holds and the backup manifest; use a grace period so an in-flight upload is not removed. Paginate inventory and process bounded, retryable batches.

Delete physical bytes through the Supabase **Storage API** (`storage.from('attachments').remove(paths)`) using a tightly controlled server process. Never delete `storage.objects` rows directly to simulate physical deletion. Verify each deletion's result before removing or reconciling application metadata; log identifiers/counts and errors without filenames or signed URLs. Require a reviewed dry-run sample before enabling a destructive schedule. Current per-attachment deletion uses Storage API first, then metadata deletion; failures need reconciliation rather than a blanket retry that hides mismatches.

## Credential rotation and revocation

- Rotate the server-only Supabase key in the platform secret store and web runtime, deploy, verify scheduled dispatch, then retire the old key. Confirm no public build, desktop bundle, source archive or log contains it. The ordinary messaging path uses user sessions and publishable keys rather than the privileged dispatcher key.
- Rotate `CRON_SECRET` across the runtime and the real scheduler/Vault together. Confirm the new bearer succeeds and the old bearer returns `401`. Pause dispatch during a non-atomic rotation if necessary and drain the due backlog afterward. Never send bearer secrets in URL query strings.
- Publishable keys are public identifiers, not substitutes for RLS. If rotating one, rebuild public bundles and the matching runtime config; verify Auth, Storage, RPCs and private subscriptions after deployment.
- Keep the JWT expiry/revocation window documented and tested. Signing out or removing refresh sessions prevents refresh, but already issued access tokens can remain valid until expiry. RLS membership checks remove tenant access immediately on subsequent reads; topic epochs rotate on revocation, stopping future activity on old topics. Clients reauthorize/rejoin on rekey; live hosted revocation timing tests are required.
- File URLs issued before revocation can remain usable until their 60-second signature expiry. Avoid logging them. Do not promise immediate revocation of already issued URLs or removal of copies a user previously downloaded.
- Windows uses the OS-encrypted cookie vault described in `DESKTOP.md`; signing out removes persisted auth cookies. DPAPI is tied to the Windows account and does not protect against another application already running as that user.

On suspected credential compromise: scope the exposure, disable the affected credential/worker, preserve relevant sanitized audit evidence, rotate the secret, revoke affected sessions where appropriate, verify unauthorized requests fail, redeploy, and communicate through the organization's incident process. Never paste a suspected secret into an issue or chat for diagnosis.

## Scheduling operations

Scheduled rows remain queued until a verified external job invokes the dispatcher. A missing key produces `503`, and a missing/wrong/short bearer secret produces `401`. Observe both the scheduler's HTTP outcome and application processing result; a successful scheduler enqueue is not sufficient.

Track due backlog size, oldest due timestamp, processing/error counts and rows with `failed_at`/`error`. The database checks permissions again before dispatch and uses bounded, locked batches; an archived channel or revoked sender can fail even though the schedule was valid when created. Recovery should cancel/recreate the failed schedule after fixing access, not bypass authorization. Monitor duplicate ID handling under overlapping invocations and rate-limit the endpoint at the platform edge where appropriate.

## Release and rollback

Run the local and CI checks, then actual hosted authorization/Realtime/Storage/SMTP/scheduler/load tests. Save the deployed commit, migration list, public config, sanitized test evidence and release artifacts. Review dependency advisories and images against the exact lockfiles/digests; a clean audit does not establish application security.

Prefer backward-compatible database migrations and a staged app rollout. Keep the previous app artifact/config available. Rolling back app code does not reverse a destructive schema change; use a reviewed forward fix or the tested restore process. Test that older desktop clients remain compatible with changed backend contracts. Publish signed desktop versions only through the verified feed and retain the previous known-good signed artifacts; downgrade restrictions mean rollback may require a higher-version corrective release.

GitHub CI is configured, not executed by writing its YAML. Hosted monitoring, backup jobs, object cleanup, deployment, signing and update publication remain separate operational work until verified. Record open gates explicitly rather than treating configuration files as a running service.
