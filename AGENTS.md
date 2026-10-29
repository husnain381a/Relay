# Relay engineering guide

Current release focus: web/PWA. Native EXE builds and publication are deferred at the user's request. Do not commit installers, signing keys or local environment files.

Build incrementally. No production seed/demo data. All authorization belongs in PostgreSQL RLS and verified server sessions. Never expose privileged Supabase keys. Keep dependency versions exact and commit the lockfile. Every claim in docs must distinguish implemented, tested locally, tested against Supabase, and release-blocked.

Use Next.js App Router, TypeScript, Supabase, Tailwind, Zod, Radix primitives and Electron. Core source is src/. Database owner writes supabase/. Desktop owner writes desktop/. API owner writes src/lib/, src/proxy.ts, src/app/auth/, src/app/api/, tests/ (except browser tests). Main owner writes application UI, config, package.json and docs/. Coordinate contracts before changing shared files.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
