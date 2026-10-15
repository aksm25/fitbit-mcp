# Roadmap

The connector is operational and protected. The next product direction is
Health+, a separate private household application that consumes Fitbit MCP
without turning this repository into a dashboard monolith. See the complete
[Health+ product design](product-design.md).

## Completed connector reliability

- [x] Replace raw multi-source step summing with the Google Health
  `dataPoints:reconcile` stream so overlapping Fitbit tracker, MobileTrack,
  Health Connect and Google Fit records are not double-counted.
- [x] Reconcile distance, calories, active minutes and activity levels, with
  mixed-source regression and pagination coverage.
- [x] Deploy and verify the corrected civil-date total through the live local
  service, ChatGPT, and Claude.
- [x] Add weekly CI, dependency review, workflow hardening, secret scanning,
  push protection, and a protected `main` branch.
- [x] Publish an owner-only always-on portal while keeping OAuth repair,
  revocation, and profile-write tools local.

## Phase 0 — documentation and operations

- [x] Record the complete Health+ experience, architecture, privacy boundary,
  data contracts, prototypes, and phased build plan.
- [ ] Add private uptime alerting for the local service and authenticated
  portal.
- [ ] Choose an incident-notification channel and response owner.
- [ ] Tag known-good releases and record deployment dates.
- [ ] Practice Google reauthorization, Cloudflare credential rotation, and
  rollback.

## Phase 1 — Health+ foundation

- [ ] Create a separate `health-plus` repository when implementation begins.
- [ ] Build the installable Android/iPhone/desktop PWA and loopback-only API.
- [ ] Add owner invitations, verified household identities, and private
  per-member profiles.
- [ ] Run isolated Fitbit authorization/token/cache state for each member.
- [ ] Add encrypted local storage, consent, setup, privacy, and deletion
  controls.

## Phase 2 — Today and Workout

- [ ] Add personal Fitbit baselines and explained Recovery-focused, Balanced,
  Ready, and Insufficient-data categories.
- [ ] Add the ten-second energy, soreness, pain, time, and location check-in.
- [ ] Generate strength, mobility, and walking/recovery sessions inside a
  deterministic safety envelope.
- [ ] Add replaceable ExerciseAPI and MusclesWorked adapters plus a reviewed
  local fallback catalog.
- [ ] Add muscle coverage, safe alternatives, editable volume, local workout
  logs, and offline current-plan synchronization.

## Phase 3 — trends, reminders, and optional AI

- [ ] Add seven- and twenty-eight-day trends with freshness, coverage, and
  missing-data explanations.
- [ ] Add member-controlled generic daily and workout reminders.
- [ ] Add optional model-assisted exercise ranking and explanations without
  allowing AI to exceed the deterministic workload envelope.

## Phase 4 — nutrition and meal planning

- [ ] Add Fitbit food/water context, hydration/protein targets, and habit views.
- [ ] Add allergy-safe, preference-aware, training-aware meal planning.
- [ ] Keep clinical diets, diagnosis, and disease treatment out of scope.

## Phase 5 — broader ecosystem

- [ ] Add separate Health+ MCP access for another household member after the
  dashboard isolation model is proven.
- [ ] Evaluate cardio planning and additional reviewed exercise sources.
- [ ] Evaluate opt-in full local archives with encryption, retention, backup,
  deletion, export, and per-member consent.
- [ ] Evaluate CGM/metabolic sources and laboratory context behind stronger
  privacy and non-diagnostic safety gates.
- [ ] Evaluate Fitbit writeback only with upstream capability, explicit user
  confirmation, audit history, and a separate safety review.

## Continuing connector work

- More Fitbit endpoint coverage for goals, temperature and subscriptions.
- Better non-technical setup UX and more MCP client examples.
- Evaluation fixtures for realistic health and training questions.
- Optional write tools only behind explicit opt-in and safety gates.
