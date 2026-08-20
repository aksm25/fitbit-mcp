# Development, testing, and maintenance runbook

This is the practical operating guide for changing and maintaining this Fitbit
MCP safely. It covers local development, guardrails, manual and automated tests,
bug handling, releases, rollback, and failure notifications.

## The short version

For every change:

1. Create a branch; do not work directly on `main`.
2. Keep credentials and real health data out of Git, tests, logs, issues, and
   screenshots.
3. Add or update a synthetic regression test for changed behavior.
4. Run `npm test` and `npm audit --audit-level=high` locally.
5. Open a pull request and merge only after GitHub Actions is green.
6. Deploy the reviewed commit, verify `/health` and one read-only MCP call, and
   keep the previous commit available for rollback.

## One-time workstation setup

Requirements:

- Git
- Node.js 20 or newer; CI uses Node.js 22
- npm
- Access to the GitHub fork

Clone and install exactly the dependency versions recorded in
`package-lock.json`:

```bash
git clone git@github.com:aksm25/fitbit-mcp.git
cd fitbit-mcp
npm ci
npm test
```

Use `npm ci`, rather than `npm install`, for routine testing. It gives local and
CI runs the same dependency tree and does not rewrite the lockfile.

Google/Fitbit and Cloudflare credentials are runtime configuration, not source
code. Store them in the protected local config or Bitwarden as described in
[the remote portal runbook](remote-cloudflare.md). Never add them to `.env`
files that might be committed.

## Development workflow

### 1. Start from a clean, current branch

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/short-description
npm ci
```

If `git status` shows changes you do not recognize, stop and review them before
editing. Do not discard someone else's work.

### 2. Make a small change

- Application code is under `src/`.
- Regression and contract tests are under `scripts/`.
- User and operator documentation is in `README.md` and `docs/`.
- CI is defined in `.github/workflows/ci.yml`.
- Record user-visible changes in `CHANGELOG.md`.

Keep each branch focused on one fix or feature. Prefer the smallest change that
corrects the behavior.

### 3. Add the regression test first

Reproduce a bug with a synthetic fixture and make the test fail for the correct
reason. Then implement the fix and make the same test pass. Never copy a real
Fitbit response into a fixture. Replace names, dates, identifiers, measurements,
GPS coordinates, and tokens with invented values.

For activity aggregation, extend
`scripts/activity-reconciliation-test.mjs`. For a new behavior, place the test
beside the closest existing test or add a clearly named script and wire it into
the `test` command in `package.json`.

### 4. Run the local gates

During development, run the narrow test related to the change. Before a commit,
always run the full gates:

```bash
npm test
npm audit --audit-level=high
git diff --check
git status --short
```

`npm test` includes type checking, a clean TypeScript build, MCP and HTTP smoke
tests, and all regression/contract tests listed below. It uses synthetic data
and does not need Fitbit credentials.

### 5. Commit, push, and open a pull request

```bash
git add <only-the-files-for-this-change>
git diff --cached
git commit -m "Describe the change"
git push -u origin HEAD
```

In the pull request, state:

- what changed and why;
- which bug or requirement it addresses;
- which tests were added or updated;
- the result of `npm test` and `npm audit --audit-level=high`;
- whether the production service or client setup changes;
- how to roll back the change.

Do not merge while a required regression check is failing.

### 6. Deploy and verify

Deploy only a reviewed commit. On the home server, update to the reviewed
`main` commit and validate it before restarting the service:

```bash
git status --short --branch
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run build
systemctl --user restart fitbit-mcp.service
systemctl --user is-active fitbit-mcp.service
curl --fail --silent --show-error http://127.0.0.1:8010/health
```

If the worktree is not clean or any command before the restart fails, stop and
do not deploy. Restart the Fitbit service before changing the shared Cloudflare
tunnel.

Then perform one read-only MCP call, such as `fitbit_connection_status`. For
changes that affect returned health data, compare one known calendar day in the
local client and the Fitbit app. If the remote contract changed, also verify it
once from ChatGPT and Claude.

Do not put the returned health values in a public pull request or issue.

## Guardrails

These rules apply to code, tests, CI, documentation, issue reports, and chat:

- Keep the connector read-only by default.
- Never commit Google OAuth client secrets, access/refresh tokens, Cloudflare
  credentials, local config, or Bitwarden exports.
- Never commit or print personal health payloads, profile details, device IDs,
  GPS routes, or other identifying Fitbit data.
- Use invented test fixtures. Automated CI must not call the live Fitbit API.
- Keep raw data and GPS opt-in. Prefer privacy-safe structured summaries.
- Redact secrets and private payloads from errors before logging them.
- Treat each upstream metric independently: one failed metric should be reported
  as partial coverage and should not erase other valid data.
- Bound pagination and detect repeated cursors so a bad upstream response cannot
  create an infinite loop.
- Pin reproducible dependencies with `package-lock.json` and use `npm ci`.
- Require review and successful CI before merging to `main`.
- Do not add profile writes, token revocation, or new remote tools without an
  explicit safety review and operator approval.
- Health summaries and future recommendations are wellness information, not
  medical diagnosis or treatment.

If a command or screenshot exposes a secret, stop sharing it, revoke or rotate
the exposed credential, remove it from logs/history where possible, and verify
that the old credential no longer works. Deleting only the latest Git commit is
not enough because Git history may retain the secret.

## Test locations and manual commands

All maintained automated tests live in `scripts/`. The full suite is configured
in the `scripts.test` entry of `package.json`.

| Purpose | Location | Manual command |
|---|---|---|
| TypeScript type safety | `src/**/*.ts`, `tsconfig.json` | `npm run typecheck` |
| Production build | `src/**/*.ts` | `npm run build` |
| MCP tools, prompts, and resources smoke test | `scripts/smoke-tools.mjs` | `npm run smoke` |
| HTTP transport and health endpoint | `scripts/smoke-http.mjs` | `npm run smoke:http` |
| Fitbit endpoint request/response contracts | `scripts/endpoint-contract-test.mjs` | `npm run test:endpoint-contracts` |
| Activity totals, pagination, deduplication, and partial failures | `scripts/activity-reconciliation-test.mjs` | `npm run test:activity-reconciliation` |
| Daily summary fixtures | `scripts/summary-fixture-test.mjs` | `npm run test:summary` |
| Calendar-date and timezone handling | `scripts/civil-date-test.mjs` | `npm run test:civil-date` |
| Multi-day activity series | `scripts/activity-series-test.mjs` | `npm run test:activity-series` |
| Demo payload contract | `scripts/demo-contract-test.mjs` | `npm run test:demo-contract` |
| README vs live MCP contract | `scripts/readme-contract-test.mjs` | `npm run test:readme-contract` |
| Privacy filtering and cache behavior | `scripts/privacy-cache-test.mjs` | `npm run test:privacy-cache` |
| CLI setup and error experience | `scripts/cli-ux-test.mjs` | `npm run test:cli-ux` |
| Agent-facing readiness surfaces | `scripts/agent-readiness-test.mjs` | `npm run test:agent-readiness` |
| Hermes manifest integration | `scripts/hermes-agent-manifest-test.mjs` | `npm run test:hermes-agent` |
| Package and server metadata | `scripts/metadata-check.mjs` | `npm run test:metadata` |
| HTTP retry behavior | `scripts/http-retry-test.mjs` | `npm run test:http-retry` |
| HTTP response cache | `scripts/http-cache-test.mjs` | `npm run test:http-cache` |
| GitHub workflow permissions and supply-chain guardrails | `scripts/workflow-security-test.mjs` | `npm run test:workflow-security` |
| Everything above | `package.json` | `npm test` |
| Known high-severity dependency vulnerabilities | `package-lock.json` | `npm audit --audit-level=high` |

The scripts create temporary directories and synthetic responses. A regression
test should be repeatable, must clean up its temporary data, and must not depend
on the operator's account, network, current date, or tokens.

## What gets installed and how dependency changes are approved

`npm ci` installs exactly the versions and integrity hashes recorded in
`package-lock.json`. GitHub installs them on a temporary runner that is deleted
after the job. Running `npm ci` locally installs the same packages under this
repo's `node_modules/` directory; it does not install a system-wide application.

Dependencies in `package.json` have two roles:

- `dependencies` are required when Fitbit MCP runs in production. The current
  direct runtime packages provide MCP, SQLite storage, HTTP routing/CORS, and
  schema validation.
- `devDependencies` are used only to build, type-check, test, or score the
  project. `mcp-scorecard` is quality tooling and is not needed by the running
  Fitbit service.

Useful inventory commands:

```bash
npm ls --omit=dev --depth=0
npm ls --depth=0
npm explain <package-name>
npm audit --audit-level=high
```

A pull request that changes `package.json`, `package-lock.json`,
`.github/dependabot.yml`, or `.github/workflows/` is a dependency/security
change. Do not merge it until the review answers:

1. Why is this package or action needed? Is it runtime-critical or development-only?
2. Is it from the expected official publisher and repository?
3. Is the version locked and represented in `package-lock.json` with integrity metadata?
4. Does it introduce install scripts, a large transitive dependency tree, a new
   license, secrets access, write permission, deployment, or network upload?
5. Do the dependency review, `npm audit`, workflow-security test, and full test
   suite pass?

Dependabot opens reviewable pull requests for known security fixes and weekly
version updates. High-severity dependency additions fail the pull-request
dependency review. The workflow-security test fails if a workflow accesses
secrets, requests write permission, uses a self-hosted runner, downloads code
through `npx`, uses `npm install` instead of `npm ci`, or references an action
without an immutable commit SHA.

## Manual production checks

Use these after a deployment or when the portal appears unavailable:

```bash
systemctl --user is-active fitbit-mcp.service
systemctl is-active cloudflared-ubuntu-notebooklm.service
curl --fail --silent --show-error http://127.0.0.1:8010/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://fitbit-origin.aksmain.com/health
curl --silent --dump-header - --output /dev/null \
  https://fitbit-mcp.aksmain.com/mcp
```

Expected results are `active`, `active`, local HTTP 200, anonymous origin HTTP
403, and portal HTTP 401 with a Bearer OAuth challenge.

For a data-correctness check:

1. Choose one specific calendar day; avoid saying only "today" while debugging.
2. Call `fitbit_connection_status`.
3. Call the affected read-only tool for that date.
4. Check `dataCoverage.partial` and `failedMetrics` before trusting the total.
5. Compare the result with the Fitbit app.
6. If the MCP behavior changed, repeat the same date and tool in ChatGPT and
   Claude to verify both clients use the deployed version.

Never paste tokens or a complete private response into a GitHub issue. Record
only a sanitized expected result, sanitized actual result, date/time, client,
tool name, and commit SHA.

## When manual testing finds a bug

### Record it safely

Create a GitHub issue if Issues are enabled, or keep a private note until an
issue can be created. Use this template and remove personal data:

```text
Title: Short description
Environment: local / ChatGPT / Claude
Tool: fitbit_<tool_name>
Commit: output of git rev-parse --short HEAD
Test date and timezone: synthetic or redacted
Expected: what should happen
Actual: what happened, with secrets and health details removed
Reproduction steps: numbered steps
Impact: incorrect data / unavailable / privacy / setup
```

If the issue may expose tokens, private health data, or an authorization bypass,
do not file it publicly. Treat it as a security incident and rotate affected
credentials first.

### Fix it without losing the regression

1. Do not patch `main` directly.
2. Create `codex/fix-short-description` from the latest `main`.
3. Reproduce the bug with a synthetic fixture.
4. Add a focused test that fails before the fix.
5. Implement the smallest safe fix.
6. Run the focused test, then `npm test` and
   `npm audit --audit-level=high`.
7. Update `CHANGELOG.md` and any affected documentation.
8. Open a pull request and wait for CI.
9. Deploy the reviewed commit and repeat the original manual test.
10. Close the issue only after production verification.

If production is returning incorrect or unsafe data, stop using the affected
tool until it is fixed. For a severe regression, restore the prior known-good
commit and restart the service:

```bash
git log --oneline -10
git switch --detach <known-good-commit>
npm ci
npm test
npm run build
systemctl --user restart fitbit-mcp.service
curl --fail --silent --show-error http://127.0.0.1:8010/health
```

Detached checkout is an emergency rollback, not the permanent fix. Create a
normal fix branch afterward and deploy the merged repair.

For service diagnostics, use:

```bash
journalctl --user -u fitbit-mcp.service -n 100 --no-pager
```

Review logs locally and redact them before sharing.

## Automated regression schedule and reporting

`.github/workflows/ci.yml` runs the full synthetic regression suite and the
high-severity dependency audit:

- on pushes to `main` and `codex/**`;
- on pull requests targeting `main`;
- manually through **Actions > CI > Run workflow**;
- every Monday at 11:17 UTC.

The scheduled and manual triggers become active only after the workflow exists
on the repository's default branch and GitHub Actions is enabled. Scheduled
workflows use the latest default-branch commit and may start late during periods
of high GitHub Actions load.

CI success or failure is stored in the GitHub Actions run and commit/PR check;
it is not committed as a file in the repo. The test code and the fix history are
stored in Git. GitHub keeps Actions logs and artifacts for 90 days by default,
subject to the repository retention setting.

GitHub can email both successful and failed workflow results when Actions email
notifications are enabled. The recommended setting is **failure-only email** so
failures are visible without weekly success noise; successful runs remain visible
in the Actions tab and on the commit. Configure this under **GitHub Settings >
Notifications > Actions**. The person who creates or most recently changes the
schedule normally receives scheduled-workflow notifications.

Useful manual commands after GitHub CLI authentication:

```bash
gh workflow run ci.yml --repo aksm25/fitbit-mcp
gh run list --repo aksm25/fitbit-mcp --workflow ci.yml --limit 10
gh run view <run-id> --repo aksm25/fitbit-mcp --log-failed
```

GitHub CI validates the source code with synthetic data. It does **not** prove
that the home server, Cloudflare tunnel, Google OAuth session, Fitbit upstream
API, ChatGPT, or Claude is currently working. Those need separate live
monitoring and periodic end-to-end checks.

Official GitHub references:

- [Workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)
- [Manage Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)
- [Run a workflow manually](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Workflow events and schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Log and artifact retention](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts)
- [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)

## Recommended repository settings

After CI is active on `main`, protect the `main` branch:

1. Open **GitHub repository > Settings > Branches**.
2. Add a protection rule for `main`.
3. Require a pull request before merging.
4. Require the `regression (22)` status check.
5. Require branches to be up to date before merging.
6. Prevent force pushes and deletion of `main`.

Also enable Dependabot alerts and security updates, and keep GitHub Issues
available for sanitized bug tracking. Never use an issue as a storage location
for private health data.

## Maintenance cadence

| Frequency | Task |
|---|---|
| Every change | Focused test, full `npm test`, dependency audit, PR, production smoke check |
| Weekly | Review the scheduled CI result and any dependency alert |
| Monthly | Verify local service, Cloudflare path, one dated Fitbit read, and both remote clients |
| Quarterly | Update dependencies on a branch, run the full suite, and practice a rollback |
| Before August 17, 2027 | Rotate the Cloudflare Access service token using the remote portal runbook |

## Remaining gaps to close

The code regression process is covered, but a dependable always-on service also
needs these operational controls:

1. **Activate CI on the default branch.** Until `.github/workflows/ci.yml` is
   pushed and merged to `main`, the weekly schedule and notifications are not
   active.
2. **Enable branch protection.** This turns “CI should pass” into an enforced
   merge rule.
3. **Add private uptime alerts.** Monitor the local service and authenticated
   portal from a trusted system. GitHub Actions cannot see most runtime failures.
4. **Choose an incident channel and owner.** Decide who receives alerts and how
   quickly privacy, outage, and data-correctness failures should be handled.
5. **Test recovery.** Practice Google reauthorization, Cloudflare credential
   rotation, and rollback before an emergency.
6. **Define releases.** Tag known-good production commits and record deployment
   dates so rollback targets are unambiguous.

These are the main items that were missing from a complete SDLC/CI-CD lifecycle.
The first two should be done next; uptime alerting should follow once the remote
service is stable.
