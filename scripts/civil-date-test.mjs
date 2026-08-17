import assert from 'node:assert/strict';
import { civilDateInTimeZone, resolveCivilDate, shiftCivilDate } from '../dist/services/civil-date.js';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';

const instant = new Date('2026-08-17T02:30:00.000Z');
assert.equal(civilDateInTimeZone('America/New_York', instant), '2026-08-16');
assert.equal(civilDateInTimeZone('UTC', instant), '2026-08-17');
assert.equal(resolveCivilDate('today', 'America/New_York', instant), '2026-08-16');
assert.equal(shiftCivilDate('2026-03-08', -1), '2026-03-07');
assert.equal(shiftCivilDate('2026-11-01', 1), '2026-11-02');
assert.throws(() => civilDateInTimeZone('Not/A_Timezone', instant), /Invalid IANA timezone/);

const requested = [];
const completeClient = {
  async get(endpoint) {
    requested.push(endpoint);
    if (endpoint.includes('/activities/date/')) return { summary: { steps: 5000, caloriesOut: 1800, caloriesOutComplete: true, fairlyActiveMinutes: 20, veryActiveMinutes: 10 } };
    if (endpoint.includes('/sleep/date/')) return { summary: { totalMinutesAsleep: 420, totalSleepRecords: 1 }, sleep: [{ efficiency: 90 }] };
    if (endpoint.includes('/activities/heart/date/')) return { 'activities-heart': [{ value: { restingHeartRate: 60 } }] };
    if (endpoint.includes('/hrv/date/')) return { hrv: [{ value: { rmssd: 40 } }] };
    if (endpoint.includes('/body/log/weight/date/')) return { weight: [] };
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};

const daily = await buildDailySummary(completeClient, { days: 7, timezone: 'America/New_York', now: instant });
assert.equal(daily.window.date, '2026-08-16');
assert.equal(daily.window.timezone, 'America/New_York');
assert.equal(daily.data_quality.confidence, 'high');
assert.equal(daily.diagnostic.readiness_context, 'good_base');
assert.ok(requested.every((endpoint) => endpoint.includes('2026-08-16')));

requested.length = 0;
const weekly = await buildWeeklySummary(completeClient, { days: 7, compare_days: 0, timezone: 'America/New_York', now: instant });
assert.equal(weekly.window.start_date, '2026-08-10');
assert.equal(weekly.window.end_date, '2026-08-16');
assert.ok(requested.some((endpoint) => endpoint.includes('2026-08-10')));
assert.ok(requested.every((endpoint) => !endpoint.includes('2026-08-17')));

const emptyClient = {
  async get(endpoint) {
    if (endpoint.includes('/activities/date/')) return { summary: { distances: [], dataCoverage: { activity: false } } };
    if (endpoint.includes('/sleep/date/')) return { summary: { totalMinutesAsleep: 0, totalSleepRecords: 0 }, sleep: [] };
    if (endpoint.includes('/activities/heart/date/')) return { 'activities-heart': [{ value: {} }] };
    if (endpoint.includes('/hrv/date/')) return { hrv: [] };
    if (endpoint.includes('/body/log/weight/date/')) return { weight: [] };
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};
const empty = await buildDailySummary(emptyClient, { days: 7, timezone: 'America/New_York', now: instant });
assert.equal(empty.data_quality.confidence, 'low');
assert.equal(empty.data_quality.missing_or_failed.activity, true);
assert.equal(empty.data_quality.missing_or_failed.sleep, true);
assert.equal(empty.scorecard.steps, undefined);
assert.equal(empty.scorecard.active_minutes, undefined);
assert.equal(empty.diagnostic.readiness_context, 'insufficient_data');
assert.match(empty.diagnostic.primary_signal, /incomplete/);

console.log(JSON.stringify({ ok: true, suite: 'civil-date-and-data-quality' }, null, 2));
