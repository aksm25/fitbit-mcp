# Roadmap

## Immediate reliability work

- [ ] Replace raw multi-source step summing with the Google Health `dataPoints:reconcile` stream so Fitbit tracker, MobileTrack, Health Connect and Google Fit records are not double-counted.
- [ ] Add mixed-source regression fixtures and audit distance, calories and active-minute totals for the same duplication class.
- [ ] Deploy the corrected server and verify the same civil-date totals locally, in ChatGPT and in Claude.

## Longer-term connector work

- More Fitbit endpoint coverage for goals, temperature and subscriptions.
- Better non-technical setup UX.
- More MCP client examples.
- Evaluation fixtures for realistic health and training questions.
- Optional write tools only behind explicit opt-in and safety gates.
