# Privacy

Fitbit health data is sensitive. This MCP stores OAuth tokens locally under `~/.fitbit-mcp/` and never prints token values.

## Modes

- `summary`: minimal fields for safe agent use.
- `structured`: Google Health data normalized into stable Fitbit MCP response shapes.
- `raw`: upstream Fitbit JSON, only when explicitly requested.

## Boundary

The MCP uses the official Google Health API. It does not expose raw accelerometer telemetry, private Google endpoints, or medical diagnosis.
