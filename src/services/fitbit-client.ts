import { URL, URLSearchParams } from "node:url";
import {
  DEFAULT_LIMIT,
  FITBIT_API_BASE_URL,
  FITBIT_AUTH_URL,
  FITBIT_REVOKE_URL,
  FITBIT_TOKEN_URL,
  MAX_FITBIT_LIMIT
} from "../constants.js";
import type { FitbitConfig, FitbitTokenSet } from "../types.js";
import { disabledCacheStatus, FitbitCache, type CacheStatus } from "./cache.js";
import { fetchWithCache, getCacheStats } from "./http-cache.js";
import { fetchWithRetry as fetchWithRetryMiddleware } from "./http-retry.js";
import { redactErrorMessage } from "./redaction.js";
import { TokenStore } from "./token-store.js";
import { resolveCivilDate, shiftCivilDate } from "./civil-date.js";

type JsonRecord = Record<string, unknown>;

export interface ListParams {
  after?: string;
  before?: string;
  page?: number;
  limit?: number;
  all_pages?: boolean;
  max_pages?: number;
}

interface GooglePage {
  dataPoints?: unknown[];
  nextPageToken?: string;
}

const DAILY_TYPES = new Set([
  "daily-resting-heart-rate",
  "daily-heart-rate-zones",
  "daily-heart-rate-variability",
  "daily-respiratory-rate",
  "daily-oxygen-saturation"
]);

const SAMPLE_TYPES = new Set(["heart-rate", "oxygen-saturation", "weight"]);

/**
 * Google Health API client with a compatibility layer for the public fitbit_*
 * tool contract. Keeping the tool contract stable avoids breaking existing
 * MCP clients while the upstream data source moves off the retired Fitbit API.
 */
export class FitbitClient {
  private readonly tokenStore: TokenStore;
  private cache?: FitbitCache;

  constructor(private readonly config: FitbitConfig) {
    this.tokenStore = new TokenStore(config.tokenPath);
  }

  authUrl(state?: string, scopes?: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: (scopes?.length ? scopes : this.config.scopes).join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true"
    });
    if (state) params.set("state", state);
    return `${FITBIT_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(input: string): Promise<{ ok: true; token_path: string; scope?: string; expires_at?: number }> {
    const code = this.extractCode(input);
    const tokens = await this.requestTokens(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri
    }));
    const redirectScope = this.extractScope(input);
    const stored = { ...tokens, scope: tokens.scope ?? redirectScope };
    await this.tokenStore.withLock(async () => this.tokenStore.write(stored));
    return { ok: true, token_path: this.config.tokenPath, scope: stored.scope, expires_at: stored.expires_at };
  }

  async get(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    if (path.includes("/profile.json")) return this.getProfile();
    if (path.includes("/devices.json")) return this.getDevices();
    if (path.includes("/activities/heart/date/") && path.includes("/1d/") ) return this.getHeartIntraday(path);
    if (path.includes("/activities/heart/date/")) return this.getHeartDay(pathDate(path));
    if (path.includes("/activities/date/")) return this.getActivityDay(pathDate(path));
    if (path.includes("/sleep/date/")) return this.getSleepDay(pathDate(path));
    if (path.includes("/hrv/date/")) return this.getDailyMetric("daily-heart-rate-variability", pathDate(path), "hrv");
    if (path.includes("/br/date/")) return this.getDailyMetric("daily-respiratory-rate", pathDate(path), "br");
    if (path.includes("/spo2/date/")) return this.getDailyMetric("daily-oxygen-saturation", pathDate(path), "spo2");
    if (path.includes("/body/log/weight/date/")) return this.getWeightDay(pathDate(path));
    if (path.includes("/foods/log/water/date/")) return this.getHydrationDay(pathDate(path));
    if (path.includes("/foods/log/date/")) return this.getNutritionDay(pathDate(path));
    if (/\/activities\/[^/]+\.json$/.test(path)) return this.getDataPoint("exercise", path.split("/").at(-1)!.replace(/\.json$/, ""));

    // Native Google Health paths remain available for development and testing.
    if (path.startsWith("/v4/")) return this.requestGoogle(path, params);
    throw new Error(`Unsupported Google Health compatibility endpoint: ${path}`);
  }

  async post(): Promise<never> {
    throw new Error("This connector is read-only. Google Health write operations are disabled.");
  }

  async revokeAccess(): Promise<{ ok: true; token_path: string; local_tokens_cleared: boolean }> {
    const token = await this.getValidToken();
    const response = await this.fetchWithRetry(FITBIT_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ token: token.access_token }).toString()
    });
    await this.parseResponse(response, true);
    await this.tokenStore.withLock(async () => this.tokenStore.clear());
    return { ok: true, token_path: this.config.tokenPath, local_tokens_cleared: true };
  }

  cacheStatus(): CacheStatus {
    const stats = getCacheStats();
    const http_cache = {
      size: stats.size,
      hit_count: stats.hit_count,
      miss_count: stats.miss_count,
      hit_rate: stats.hit_rate,
      default_ttl_seconds: 60,
      bypass_env_var: "FITBIT_NO_CACHE"
    };
    if (!this.config.cacheEnabled) return { ...disabledCacheStatus(this.config.cachePath), http_cache };
    return { ...this.getCache().status(), http_cache };
  }

  async list(path: string, params: ListParams = {}): Promise<{ records: unknown[]; next_page?: number; pages_fetched: number }> {
    if (params.after && params.before) throw new Error("A list accepts either after or before, not both");
    const dataType = path.includes("sleep") ? "sleep" : "exercise";
    const requestedLimit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_FITBIT_LIMIT);
    const limit = dataType === "sleep" || dataType === "exercise" ? Math.min(requestedLimit, 25) : requestedLimit;
    const startPage = Math.max(params.page ?? 1, 1);
    const maxPages = params.all_pages ? Math.max(1, params.max_pages ?? 1) : 1;
    const filter = buildCursorFilter(dataType, params);

    let token: string | undefined;
    for (let page = 1; page < startPage; page += 1) {
      const skipped = await this.listDataPoints(dataType, { filter, pageSize: limit, pageToken: token });
      token = skipped.nextPageToken;
      if (!token) return { records: [], pages_fetched: 0 };
    }

    const records: unknown[] = [];
    let pagesFetched = 0;
    let nextToken = token;
    while (pagesFetched < maxPages) {
      const page = await this.listDataPoints(dataType, { filter, pageSize: limit, pageToken: nextToken });
      const points = page.dataPoints ?? [];
      records.push(...points.map((point) => dataType === "sleep" ? legacySleep(point) : legacyExercise(point)));
      pagesFetched += 1;
      nextToken = page.nextPageToken;
      if (!params.all_pages || !nextToken) break;
    }

    return {
      records,
      next_page: nextToken ? startPage + pagesFetched : undefined,
      pages_fetched: pagesFetched
    };
  }

  private async getProfile(): Promise<unknown> {
    const [profile, settings] = await Promise.all([
      this.requestGoogle("/v4/users/me/profile"),
      this.requestGoogle("/v4/users/me/settings")
    ]);
    return { user: { ...asRecord(profile), settings } };
  }

  private async getDevices(): Promise<unknown> {
    const payload = asRecord(await this.requestGoogle("/v4/users/me/pairedDevices"));
    return arrayAt(payload, ["pairedDevices", "devices"]);
  }

  private async getActivityDay(date: string): Promise<unknown> {
    const types = ["steps", "active-energy-burned", "basal-energy-burned", "distance", "active-minutes", "activity-level"];
    const pages = await Promise.all(types.map((type) => this.listDataPoints(type, {
      filter: dateFilter(type, date),
      pageSize: 10000
    })));
    const byType = Object.fromEntries(types.map((type, index) => [type, pages[index].dataPoints ?? []]));
    const hasSteps = byType.steps.length > 0;
    const hasActiveCalories = byType["active-energy-burned"].length > 0;
    const hasBasalCalories = byType["basal-energy-burned"].length > 0;
    const hasDistance = byType.distance.length > 0;
    const hasActiveMinutes = byType["active-minutes"].length > 0;
    const hasActivityLevels = byType["activity-level"].length > 0;
    const steps = hasSteps ? sumPoints(byType.steps, "steps", "count") : undefined;
    const activeCalories = hasActiveCalories ? sumPoints(byType["active-energy-burned"], "active-energy-burned", "kcal") : undefined;
    const basalCalories = hasBasalCalories ? sumPoints(byType["basal-energy-burned"], "basal-energy-burned", "kcal") : undefined;
    const calories = activeCalories === undefined && basalCalories === undefined
      ? undefined
      : (activeCalories ?? 0) + (basalCalories ?? 0);
    const distanceKm = hasDistance ? sumPoints(byType.distance, "distance", "millimeters", "distanceMillimeters") / 1_000_000 : undefined;
    const active = aggregateActiveMinutes(byType["active-minutes"]);
    const levels = aggregateActivityLevels(byType["activity-level"]);
    return {
      activities: [],
      goals: {},
      summary: {
        steps,
        caloriesOut: calories,
        activeCalories,
        basalCalories,
        caloriesOutComplete: hasActiveCalories && hasBasalCalories,
        calorieSources: { active: hasActiveCalories, basal: hasBasalCalories },
        sedentaryMinutes: hasActivityLevels ? levels.sedentary : undefined,
        lightlyActiveMinutes: hasActiveMinutes || hasActivityLevels ? active.lightlyActive || levels.lightlyActive : undefined,
        fairlyActiveMinutes: hasActiveMinutes || hasActivityLevels ? active.fairlyActive || levels.fairlyActive : undefined,
        veryActiveMinutes: hasActiveMinutes || hasActivityLevels ? active.veryActive || levels.veryActive : undefined,
        distances: hasDistance ? [{ activity: "total", distance: round(distanceKm!, 3) }] : [],
        dataCoverage: {
          activity: hasSteps || hasActiveCalories || hasBasalCalories || hasDistance || hasActiveMinutes || hasActivityLevels,
          steps: hasSteps,
          activeMinutes: hasActiveMinutes || hasActivityLevels,
          calories: hasActiveCalories || hasBasalCalories
        }
      }
    };
  }

  private async getSleepDay(date: string): Promise<unknown> {
    const page = await this.listDataPoints("sleep", { filter: dateFilter("sleep", date), pageSize: 25 });
    const sleep = (page.dataPoints ?? []).map(legacySleep);
    const totalMinutesAsleep = sum(sleep.map((entry) => numberAt(asRecord(entry), ["minutesAsleep"])));
    const totalTimeInBed = sum(sleep.map((entry) => numberAt(asRecord(entry), ["timeInBed"])));
    return {
      sleep,
      summary: {
        totalMinutesAsleep,
        totalTimeInBed,
        totalSleepRecords: sleep.length,
        efficiencyAverage: sleep.length ? round(sum(sleep.map((entry) => numberAt(asRecord(entry), ["efficiency"]))) / sleep.length, 0) : undefined
      }
    };
  }

  private async getHeartDay(date: string): Promise<unknown> {
    const [restingPage, zonesPage] = await Promise.all([
      this.listDataPoints("daily-resting-heart-rate", { filter: dateFilter("daily-resting-heart-rate", date), pageSize: 10 }),
      this.listDataPoints("daily-heart-rate-zones", { filter: dateFilter("daily-heart-rate-zones", date), pageSize: 10 })
    ]);
    const resting = dataPointBody(restingPage.dataPoints?.[0], "daily-resting-heart-rate");
    const zones = dataPointBody(zonesPage.dataPoints?.[0], "daily-heart-rate-zones");
    return {
      "activities-heart": [{
        dateTime: date,
        value: {
          restingHeartRate: numberAt(resting, ["beatsPerMinute", "restingHeartRateBeatsPerMinute"]),
          heartRateZones: legacyHeartZones(arrayAt(zones, ["heartRateZones", "zones"]))
        }
      }]
    };
  }

  private async getHeartIntraday(path: string): Promise<unknown> {
    const date = pathDate(path);
    const timeMatch = /\/time\/(\d{2}:\d{2})\/(\d{2}:\d{2})/.exec(path);
    const page = await this.listDataPoints("heart-rate", {
      filter: dateFilter("heart-rate", date, timeMatch?.[1], timeMatch?.[2]),
      pageSize: 10000
    });
    const dataset = (page.dataPoints ?? []).map((point) => {
      const body = dataPointBody(point, "heart-rate");
      const sampleTime = asRecord(body.sampleTime ?? body.sample_time);
      const sample = civilTime(sampleTime.civilTime ?? sampleTime.civil_time ?? sampleTime.physicalTime ?? sampleTime.physical_time);
      return { time: sample.slice(11, 19), value: numberAt(body, ["beatsPerMinute"]) };
    }).filter((entry) => entry.time && entry.value !== undefined);
    return {
      "activities-heart": [{ dateTime: date, value: {} }],
      "activities-heart-intraday": {
        dataset,
        datasetInterval: 1,
        datasetType: "second"
      }
    };
  }

  private async getDailyMetric(type: string, date: string, legacyKey: "hrv" | "br" | "spo2"): Promise<unknown> {
    const page = await this.listDataPoints(type, { filter: dateFilter(type, date), pageSize: 10 });
    const body = dataPointBody(page.dataPoints?.[0], type);
    if (legacyKey === "hrv") {
      return { hrv: body === EMPTY ? [] : [{ dateTime: date, value: { rmssd: numberAt(body, ["averageHeartRateVariabilityMilliseconds", "rmssdMilliseconds"]) } }] };
    }
    if (legacyKey === "br") {
      return { br: body === EMPTY ? [] : [{ dateTime: date, value: { breathingRate: numberAt(body, ["breathsPerMinute"]) } }] };
    }
    return {
      dateTime: date,
      value: {
        avg: numberAt(body, ["averagePercentage", "averageOxygenSaturationPercentage"]),
        min: numberAt(body, ["lowerBoundPercentage", "minimumPercentage"]),
        max: numberAt(body, ["upperBoundPercentage", "maximumPercentage"])
      }
    };
  }

  private async getWeightDay(date: string): Promise<unknown> {
    const page = await this.listDataPoints("weight", { filter: dateFilter("weight", date), pageSize: 100 });
    return {
      weight: (page.dataPoints ?? []).map((point) => {
        const body = dataPointBody(point, "weight");
        const sampleTime = asRecord(body.sampleTime ?? body.sample_time);
        const sample = civilTime(sampleTime.civilTime ?? sampleTime.civil_time ?? sampleTime.physicalTime ?? sampleTime.physical_time);
        return {
          logId: dataPointId(point),
          date: sample.slice(0, 10) || date,
          time: sample.slice(11, 19),
          weight: round(numberAt(body, ["weightGrams"]) / 1000, 3),
          source: "Google Health"
        };
      })
    };
  }

  private async getNutritionDay(date: string): Promise<unknown> {
    const page = await this.listDataPoints("nutrition-log", { filter: dateFilter("nutrition-log", date), pageSize: 100 });
    return { foods: (page.dataPoints ?? []).map((point) => ({ logId: dataPointId(point), ...dataPointBody(point, "nutrition-log") })) };
  }

  private async getHydrationDay(date: string): Promise<unknown> {
    const page = await this.listDataPoints("hydration-log", { filter: dateFilter("hydration-log", date), pageSize: 100 });
    return { water: (page.dataPoints ?? []).map((point) => ({ logId: dataPointId(point), ...dataPointBody(point, "hydration-log") })) };
  }

  private async getDataPoint(type: string, id: string): Promise<unknown> {
    const point = await this.requestGoogle(`/v4/users/me/dataTypes/${encodeURIComponent(type)}/dataPoints/${encodeURIComponent(id)}`);
    return { activity: legacyExercise(point) };
  }

  private async listDataPoints(type: string, params: { filter?: string; pageSize?: number; pageToken?: string }): Promise<GooglePage> {
    return await this.requestGoogle(`/v4/users/me/dataTypes/${encodeURIComponent(type)}/dataPoints`, params) as GooglePage;
  }

  private async requestGoogle(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const token = await this.getValidToken();
    const url = new URL(`${FITBIT_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await this.fetchWithRetry(url.toString(), {
      method: "GET",
      headers: this.jsonHeaders(token.access_token)
    });
    if (response.status === 401) {
      const refreshed = await this.refreshToken(true);
      const retry = await this.fetchWithRetry(url.toString(), {
        method: "GET",
        headers: this.jsonHeaders(refreshed.access_token)
      });
      return this.parseAndCache(url.toString(), retry);
    }
    return this.parseAndCache(url.toString(), response);
  }

  private extractCode(input: string): string {
    try {
      const url = new URL(input);
      return url.searchParams.get("code") ?? input;
    } catch {
      return input;
    }
  }

  private extractScope(input: string): string | undefined {
    try {
      return new URL(input).searchParams.get("scope") ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async getValidToken(): Promise<FitbitTokenSet> {
    const tokens = await this.tokenStore.read();
    if (!tokens?.access_token) {
      throw new Error("Google Health token not found. Run fitbit-mcp-server auth, or use fitbit_get_auth_url then fitbit_exchange_code.");
    }
    const expiresAt = tokens.expires_at ?? 0;
    const shouldRefresh = Boolean(tokens.refresh_token && expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 3600);
    return shouldRefresh ? this.refreshToken(false) : tokens;
  }

  private async refreshToken(force: boolean): Promise<FitbitTokenSet> {
    return this.tokenStore.withLock(async () => {
      const current = await this.tokenStore.read();
      if (!current?.refresh_token) throw new Error("Google refresh token not found. Re-authorize with fitbit-mcp-server auth.");
      if (!force && current.expires_at && current.expires_at - Math.floor(Date.now() / 1000) >= 3600) return current;
      const refreshed = await this.requestTokens(new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refresh_token
      }));
      const merged = { ...current, ...refreshed, refresh_token: refreshed.refresh_token ?? current.refresh_token };
      await this.tokenStore.write(merged);
      return merged;
    });
  }

  private async requestTokens(body: URLSearchParams): Promise<FitbitTokenSet> {
    body.set("client_id", this.config.clientId);
    body.set("client_secret", this.config.clientSecret);
    const response = await this.fetchWithRetry(FITBIT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString()
    });
    const data = asRecord(await this.parseResponse(response));
    const expiresIn = numberAt(data, ["expires_in"]);
    return {
      access_token: String(data.access_token ?? ""),
      refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      token_type: typeof data.token_type === "string" ? data.token_type : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
      expires_in: expiresIn || undefined,
      expires_at: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined
    };
  }

  private jsonHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  }

  private async parseResponse(response: Response, allowEmpty = false): Promise<unknown> {
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    if (!response.ok) {
      const details = payload && typeof payload === "object" ? JSON.stringify(payload) : text;
      throw new Error(`Google Health API HTTP ${response.status}: ${redactErrorMessage(details || response.statusText)}`);
    }
    return allowEmpty && !text ? {} : payload;
  }

  private async parseAndCache(url: string, response: Response): Promise<unknown> {
    try {
      const payload = await this.parseResponse(response);
      if (this.config.cacheEnabled) this.getCache().set("GET", url, payload);
      return payload;
    } catch (error) {
      if (this.config.cacheEnabled) {
        const cached = this.getCache().get("GET", url);
        if (cached !== undefined) return cached;
      }
      throw error;
    }
  }

  private getCache(): FitbitCache {
    this.cache ??= new FitbitCache(this.config.cachePath);
    return this.cache;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const retryWrappedFetch = (target: string, requestInit?: RequestInit) => fetchWithRetryMiddleware(fetch, target, requestInit, {
      vendor: "google-health",
      envFlag: "FITBIT_NO_RETRY"
    });
    return fetchWithCache(url, init, {
      defaultTtlSeconds: 60,
      envVarBypass: "FITBIT_NO_CACHE",
      innerFetch: retryWrappedFetch
    });
  }
}

const EMPTY: JsonRecord = Object.freeze({});

function pathDate(path: string): string {
  const match = /\/date\/([^/.]+)/.exec(path);
  if (!match) throw new Error(`Date missing from endpoint: ${path}`);
  return normalizeToday(toFitbitCivilDate(match[1]));
}

function normalizeToday(date: string): string {
  return resolveCivilDate(date);
}

function dateFilter(type: string, date: string, startTime?: string, endTime?: string): string {
  const day = normalizeToday(date);
  const next = addDays(day, 1);
  if (DAILY_TYPES.has(type)) return `${toSnake(type)}.date >= "${day}" AND ${toSnake(type)}.date < "${next}"`;
  const field = type === "sleep" ? "civil_end_time" : SAMPLE_TYPES.has(type) ? "civil_time" : "civil_start_time";
  const owner = toSnake(type);
  if (field === "civil_time") {
    const upper = endTime ? `${day}T${endTime}:00` : `${next}T00:00:00`;
    return `${owner}.sample_time.civil_time >= "${day}T${startTime ?? "00:00"}:00" AND ${owner}.sample_time.civil_time < "${upper}"`;
  }
  const upper = endTime ? `${day}T${endTime}:00` : `${next}T00:00:00`;
  return `${owner}.interval.${field} >= "${day}T${startTime ?? "00:00"}:00" AND ${owner}.interval.${field} < "${upper}"`;
}

function buildCursorFilter(type: string, params: ListParams): string | undefined {
  const owner = toSnake(type);
  const field = type === "sleep" ? "civil_end_time" : "civil_start_time";
  if (params.after) return `${owner}.interval.${field} >= "${normalizeToday(toFitbitCivilDate(params.after))}T00:00:00"`;
  if (params.before) return `${owner}.interval.${field} < "${normalizeToday(toFitbitCivilDate(params.before))}T00:00:00"`;
  return undefined;
}

function legacyExercise(point: unknown): JsonRecord {
  const body = dataPointBody(point, "exercise");
  const interval = asRecord(body.interval);
  const summary = asRecord(body.metricsSummary);
  const start = civilTime(interval.civilStartTime ?? interval.civil_start_time ?? interval.startTime ?? interval.start_time);
  const end = civilTime(interval.civilEndTime ?? interval.civil_end_time ?? interval.endTime ?? interval.end_time);
  return {
    logId: dataPointId(point),
    activityName: body.displayName ?? body.exerciseType ?? "Exercise",
    activityTypeId: body.exerciseType,
    startTime: start,
    duration: durationMs(start, end),
    steps: numberAt(summary, ["steps"]),
    calories: numberAt(summary, ["caloriesKcal"]),
    distance: numberAt(summary, ["distanceMillimeters"]) / 1_000_000,
    averageHeartRate: numberAt(summary, ["averageHeartRateBeatsPerMinute"]),
    source: "Google Health"
  };
}

function legacySleep(point: unknown): JsonRecord {
  const body = dataPointBody(point, "sleep");
  const interval = asRecord(body.interval);
  const summary = asRecord(body.summary);
  const start = civilTime(interval.civilStartTime ?? interval.civil_start_time ?? interval.startTime ?? interval.start_time);
  const end = civilTime(interval.civilEndTime ?? interval.civil_end_time ?? interval.endTime ?? interval.end_time);
  const minutesAsleep = numberAt(summary, ["minutesAsleep"]);
  const timeInBed = numberAt(summary, ["minutesInSleepPeriod", "minutesInBed"]);
  return {
    logId: dataPointId(point),
    dateOfSleep: end.slice(0, 10),
    startTime: start,
    endTime: end,
    duration: durationMs(start, end),
    minutesAsleep,
    minutesAwake: numberAt(summary, ["minutesAwake"]),
    timeInBed,
    efficiency: timeInBed ? round((minutesAsleep / timeInBed) * 100, 0) : undefined,
    levels: { summary: summary.stagesSummary ?? [], data: body.stages ?? [] },
    isMainSleep: asRecord(body.metadata).mainSleep !== false,
    source: "Google Health"
  };
}

function dataPointBody(point: unknown, type: string): JsonRecord {
  const record = asRecord(point);
  const camel = toCamel(type);
  const snake = toSnake(type);
  const direct = record[camel] ?? record[snake] ?? record.data;
  return direct && typeof direct === "object" && !Array.isArray(direct) ? direct as JsonRecord : record === EMPTY ? EMPTY : record;
}

function dataPointId(point: unknown): string | undefined {
  const record = asRecord(point);
  const name = typeof record.name === "string" ? record.name : typeof record.id === "string" ? record.id : undefined;
  return name?.split("/").at(-1);
}

function aggregateActiveMinutes(points: unknown[] = []): { lightlyActive: number; fairlyActive: number; veryActive: number } {
  const result = { lightlyActive: 0, fairlyActive: 0, veryActive: 0 };
  for (const point of points) {
    const body = dataPointBody(point, "active-minutes");
    for (const item of arrayAt(body, ["activeMinutesByActivityLevel", "minutesByActivityLevel"])) {
      const entry = asRecord(item);
      const level = String(entry.activityLevel ?? "");
      const minutes = numberAt(entry, ["activeMinutes", "minutes"]);
      if (level === "LIGHT") result.lightlyActive += minutes;
      if (level === "MODERATE") result.fairlyActive += minutes;
      if (level === "VIGOROUS") result.veryActive += minutes;
    }
  }
  return result;
}

function aggregateActivityLevels(points: unknown[] = []): { sedentary: number; lightlyActive: number; fairlyActive: number; veryActive: number } {
  const result = { sedentary: 0, lightlyActive: 0, fairlyActive: 0, veryActive: 0 };
  for (const point of points) {
    const body = dataPointBody(point, "activity-level");
    const interval = asRecord(body.interval);
    const minutes = durationMs(
      civilTime(interval.civilStartTime ?? interval.civil_start_time ?? interval.startTime ?? interval.start_time),
      civilTime(interval.civilEndTime ?? interval.civil_end_time ?? interval.endTime ?? interval.end_time)
    ) / 60000;
    const level = String(body.activityLevelType ?? body.activityLevel ?? "");
    if (level === "SEDENTARY") result.sedentary += minutes;
    if (level === "LIGHTLY_ACTIVE") result.lightlyActive += minutes;
    if (level === "MODERATELY_ACTIVE") result.fairlyActive += minutes;
    if (level === "VERY_ACTIVE") result.veryActive += minutes;
  }
  return result;
}

function sumPoints(points: unknown[] = [], type: string, ...keys: string[]): number {
  return sum(points.map((point) => numberAt(dataPointBody(point, type), keys)));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : EMPTY;
}

function arrayAt(record: JsonRecord, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function numberAt(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function civilTime(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (typeof record.civilTime === "string") return record.civilTime;
  if (typeof record.civil_time === "string") return record.civil_time;
  if (typeof record.dateTime === "string") return record.dateTime;
  const date = asRecord(record.date);
  if (date.year && date.month && date.day) {
    const time = asRecord(record.time);
    return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(time.hours ?? 0)}:${pad(time.minutes ?? 0)}:${pad(time.seconds ?? 0)}`;
  }
  return "";
}

function legacyHeartZones(zones: unknown[]): JsonRecord[] {
  return zones.map((zone) => {
    const record = asRecord(zone);
    return {
      name: record.heartRateZoneType,
      min: numberAt(record, ["minBeatsPerMinute"]),
      max: numberAt(record, ["maxBeatsPerMinute"])
    };
  });
}

function pad(value: unknown): string {
  return String(typeof value === "number" || typeof value === "string" ? value : 0).padStart(2, "0");
}

function durationMs(start: string, end: string): number {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function addDays(date: string, days: number): string {
  return shiftCivilDate(date, days);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toSnake(value: string): string {
  return value.replace(/-/g, "_");
}

/** Accept today, YYYY-MM-DD, or an ISO date-time. */
export function toFitbitCivilDate(value: string, field = "date"): string {
  if (value === "today") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) throw new Error(`Invalid Fitbit ${field}: expected yyyy-MM-dd or today`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`Invalid Fitbit ${field}: ${value}`);
  return date;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
