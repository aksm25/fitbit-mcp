# Always-on Cloudflare portal

This deployment keeps Fitbit and Google OAuth credentials on the home server while making selected read-only MCP tools available to authenticated remote AI clients.

The operator endpoint is:

`https://fitbit-mcp.aksmain.com/mcp`

Do not configure clients with the private origin hostname. Do not enter a Cloudflare Access client ID or secret into ChatGPT or Claude.

## Trust boundary

The production path is:

1. `fitbit-mcp.service` listens only on `127.0.0.1:8010`.
2. The existing healthy Cloudflare tunnel publishes that loopback listener as `fitbit-origin.aksmain.com`.
3. Cloudflare Access rejects origin requests unless the dedicated service-token headers are valid.
4. Cloudflare MCP controls store those headers and synchronize the upstream tools.
5. The managed-OAuth portal at `fitbit-mcp.aksmain.com` allows only the operator account.

The portal exposes 29 of 33 tools and all three read-only prompts. These four tools stay disabled remotely:

- `fitbit_get_auth_url`
- `fitbit_exchange_code`
- `fitbit_revoke_access`
- `fitbit_profile_update`

Google Health authorization and token repair must be performed locally on the server.

## Client setup

Add `https://fitbit-mcp.aksmain.com/mcp` as a custom remote MCP server in a supported ChatGPT or Claude client. Allow OAuth discovery and dynamic registration, then sign in through Cloudflare Access with the approved operator account.

Managed OAuth permits only these callback paths:

- `https://chatgpt.com/connector/oauth/*`
- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

Localhost and generic loopback OAuth clients are disabled. No ChatGPT or Claude client secret is required.

## Routine checks

```bash
systemctl --user is-active fitbit-mcp.service
systemctl is-active cloudflared-ubuntu-notebooklm.service
curl --fail --silent --show-error http://127.0.0.1:8010/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://fitbit-origin.aksmain.com/health
curl --silent --dump-header - --output /dev/null \
  https://fitbit-mcp.aksmain.com/mcp
```

Expected results are `active`, `active`, local HTTP 200, anonymous origin HTTP 403, and portal HTTP 401 with a Bearer OAuth challenge.

## Recovery and rotation

Restart the local application before touching the shared tunnel:

```bash
systemctl --user restart fitbit-mcp.service
curl --fail --silent --show-error http://127.0.0.1:8010/health
```

The Access service token expires August 17, 2027. Before that date, create a replacement, store its one-time secret in Bitwarden, add it to the Service Auth policy, update both headers on the Cloudflare MCP server, verify the origin and portal, and then revoke the old token.

Never put the Access token, Google OAuth credentials, Fitbit tokens, or personal health payloads in Git, chat, screenshots, or command history.
