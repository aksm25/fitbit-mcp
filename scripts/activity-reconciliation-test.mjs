import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FitbitClient } from '../dist/services/fitbit-client.js';

const dir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-reconciliation-'));
const tokenPath = join(dir, 'tokens.json');
writeFileSync(tokenPath, JSON.stringify({ access_token: 'synthetic-token' }), { mode: 0o600 });

const client = new FitbitClient({
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  redirectUri: 'http://127.0.0.1/callback',
  scopes: [],
  tokenPath,
  privacyMode: 'structured',
  cacheEnabled: false,
  cachePath: join(dir, 'cache.sqlite'),
});

const originalFetch = globalThis.fetch;
const originalNoCache = process.env.FITBIT_NO_CACHE;
const requestedUrls = [];
process.env.FITBIT_NO_CACHE = 'true';

const responses = {
  steps: {
    first: { dataPoints: [{ steps: { count: 2209 } }], nextPageToken: 'steps-page-2' },
    next: { dataPoints: [{ steps: { count: 25 } }] },
  },
  'active-energy-burned': { dataPoints: [{ activeEnergyBurned: { kcal: 180 } }, { activeEnergyBurned: { kcal: 20 } }] },
  'basal-energy-burned': { dataPoints: [{ basalEnergyBurned: { kcal: 1500 } }] },
  distance: { dataPoints: [{ distance: { distanceMillimeters: 1_500_000 } }, { distance: { distanceMillimeters: 500_000 } }] },
  'active-minutes': {
    dataPoints: [{ activeMinutes: { activeMinutesByActivityLevel: [
      { activityLevel: 'MODERATE', activeMinutes: 10 },
      { activityLevel: 'VIGOROUS', activeMinutes: 5 },
    ] } }],
  },
  'activity-level': {
    dataPoints: [
      { activityLevel: { activityLevelType: 'SEDENTARY', interval: { civilStartTime: '2026-08-17T09:00:00', civilEndTime: '2026-08-17T09:30:00' } } },
      { activityLevel: { activityLevelType: 'LIGHTLY_ACTIVE', interval: { civilStartTime: '2026-08-17T09:30:00', civilEndTime: '2026-08-17T09:40:00' } } },
    ],
  },
};

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url);
  const match = /\/dataTypes\/([^/]+)\/dataPoints:reconcile$/.exec(url.pathname);
  assert.ok(match, `activity summary must use reconciliation, received ${url.pathname}`);
  const type = decodeURIComponent(match[1]);
  const response = responses[type];
  assert.ok(response, `unexpected reconciled data type ${type}`);
  if (type === 'steps') return Response.json(url.searchParams.has('pageToken') ? response.next : response.first);
  return Response.json(response);
};

try {
  const activity = await client.get('/1/user/-/activities/date/2026-08-17.json');
  assert.equal(activity.summary.steps, 2234, 'reconciled step intervals must be summed exactly once');
  assert.equal(activity.summary.activeCalories, 200);
  assert.equal(activity.summary.basalCalories, 1500);
  assert.equal(activity.summary.caloriesOut, 1700);
  assert.equal(activity.summary.distances[0].distance, 2);
  assert.equal(activity.summary.sedentaryMinutes, 30);
  assert.equal(activity.summary.lightlyActiveMinutes, 10);
  assert.equal(activity.summary.fairlyActiveMinutes, 10);
  assert.equal(activity.summary.veryActiveMinutes, 5);
  assert.equal(activity.summary.dataCoverage.steps, true);
  assert.equal(requestedUrls.length, 7, 'six data types plus the second step page must be fetched');

  for (const url of requestedUrls) {
    assert.match(url.pathname, /dataPoints:reconcile$/);
    assert.equal(url.searchParams.get('dataSourceFamily'), 'users/me/dataSourceFamilies/all-sources');
    assert.equal(url.searchParams.get('pageSize'), '10000');
    assert.match(url.searchParams.get('filter'), /2026-08-17T00:00:00/);
  }
  assert.equal(requestedUrls.filter((url) => url.searchParams.get('pageToken') === 'steps-page-2').length, 1);

  console.log(JSON.stringify({ ok: true, suite: 'activity-reconciliation', requests: requestedUrls.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalNoCache === undefined) delete process.env.FITBIT_NO_CACHE;
  else process.env.FITBIT_NO_CACHE = originalNoCache;
  rmSync(dir, { recursive: true, force: true });
}
