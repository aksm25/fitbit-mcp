# Contributing

Thanks for improving Fitbit MCP Unofficial.

Before opening a PR:

```bash
npm ci
npm test
npm audit --audit-level=high
```

CI runs the same gates on pushes to `main` and `codex/**`, pull requests to
`main`, manual dispatches, and a weekly schedule. All CI fixtures must remain
synthetic: never add Fitbit tokens, OAuth secrets, or personal health payloads
to GitHub Actions.

For the step-by-step development workflow, individual test commands, manual
production checks, bug-response procedure, CI notifications, and rollback, see
[the maintenance runbook](docs/maintenance.md).

Guidelines:

- Use only official Fitbit API endpoints.
- Keep default behavior read-only.
- Treat GPS data as sensitive.
- Do not add write/upload tools without explicit safety gates.
- Do not log or return OAuth tokens.
- Update docs and tests with behavior changes.
- Merge only after the regression check is green. Deploy production from a
  reviewed commit, verify `/health` and one read-only MCP call, and keep the
  previous known-good commit available for rollback.
