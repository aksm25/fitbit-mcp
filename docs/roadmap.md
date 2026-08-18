# Roadmap

## Immediate reliability work

- [x] Replace raw multi-source step summing with the Google Health `dataPoints:reconcile` stream so Fitbit tracker, MobileTrack, Health Connect and Google Fit records are not double-counted.
- [x] Use the reconciled stream for distance, calories, active minutes and activity levels, with mixed-source regression coverage and pagination checks.
- [x] Deploy the corrected server and verify the civil-date total through the live local MCP service.
- [x] Confirm the corrected total from the ChatGPT and Claude client sessions.

## Longer-term connector work

- More Fitbit endpoint coverage for goals, temperature and subscriptions.
- Better non-technical setup UX.
- More MCP client examples.
- Evaluation fixtures for realistic health and training questions.
- Optional write tools only behind explicit opt-in and safety gates.
