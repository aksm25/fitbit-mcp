# OAuth

Create a Google Cloud project and OAuth client by following:

https://developers.google.com/health/setup

Callback URL:

```text
http://127.0.0.1:3000/callback
```

The connector requests these read-only scope groups:

```text
googlehealth.activity_and_fitness.readonly
googlehealth.health_metrics_and_measurements.readonly
googlehealth.profile.readonly
googlehealth.settings.readonly
googlehealth.sleep.readonly
googlehealth.nutrition.readonly
```

Run:

```bash
npx -y fitbit-mcp-unofficial setup
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor
```
