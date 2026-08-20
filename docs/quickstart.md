# Fitbit MCP Quickstart

1. Follow https://developers.google.com/health/setup to create a Google Cloud project and OAuth client.
2. Set callback URL: `http://127.0.0.1:3000/callback`.
3. Add your Google account as an OAuth test user while the app is in testing.
4. Run:

```bash
npx -y fitbit-mcp-unofficial setup
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor
```

Add to your MCP client:

```json
{
  "mcpServers": {
    "fitbit": {
      "command": "npx",
      "args": ["-y", "fitbit-mcp-unofficial"]
    }
  }
}
```
