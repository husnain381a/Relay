# Contributing to Relay

Thanks for helping improve Relay. The current focus is the web application and installable PWA.

## Before you start

Check existing issues and pull requests for related work. For a substantial feature or architectural change, open an issue describing the problem and proposed behavior before investing in a large implementation. Small bug fixes and documentation improvements can go straight to a pull request.

Use a Supabase project you control. Never test with another team's messages, production accounts, or credentials.

## Set up locally

Follow the [README quick start](README.md#quick-start). Database changes belong in versioned migrations, and every exposed table needs appropriate access policies. See [DATABASE.md](docs/DATABASE.md).

Keep environment files, access tokens, signing material, personal data, and generated installers out of commits. The repository uses exact dependency versions and committed lockfiles.

## Make a focused change

- Explain the user-visible problem and resulting behavior.
- Match the existing interface, keyboard behavior, and responsive layouts.
- Enforce authorization on the server/database, not just in the UI.
- Keep message bodies, credentials, cookies, and signed URLs out of logs and test artifacts.
- Update relevant documentation when behavior, setup, or configuration changes.
- Add meaningful regression coverage for bugs or security boundaries. Documentation-only changes do not need new tests.

Native EXE packaging is deferred. Avoid adding desktop release work to web/PWA pull requests.

## Validate your work

Run the checks relevant to the change:

```bash
npm run typecheck
npm test
npm run test:db
npm run build
npm run security:repo
```

For PWA changes, run `npm run test:pwa` after the production build. Run the development browser suite separately with `npm run test:e2e`; see [TESTING.md](docs/TESTING.md) for its known startup issue and the requirements for real-backend tests.

Distinguish tests you ran from tests that were skipped or require another environment. Do not describe local SQL tests as proof of hosted Auth, Storage, or Realtime behavior.

## Open a pull request

Include a short description of the problem, the change, and the checks performed. Add screenshots for interface changes using empty or deliberately created test data. Keep credentials and real conversations out of screenshots.

If your change affects permissions, invitations, file access, authentication, or migrations, explain how authorized and unauthorized users are handled.

## Report a security issue

Follow [SECURITY.md](SECURITY.md). Do not publish private messages, account details, or working credentials in a public issue.

## License

Contributions to Relay are provided under the project's [MIT License](LICENSE). Third-party code and assets must retain their original notices and compatible licensing.
