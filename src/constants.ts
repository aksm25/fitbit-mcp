export const SERVER_NAME = "fitbit-mcp-server";
export const SERVER_VERSION = "0.6.2";
export const NPM_PACKAGE_NAME = "fitbit-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const FITBIT_API_BASE_URL = "https://health.googleapis.com";
export const FITBIT_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const FITBIT_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FITBIT_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
  "https://www.googleapis.com/auth/googlehealth.settings.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.nutrition.readonly"
];

export const DEFAULT_LIMIT = 30;
export const MAX_FITBIT_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 1;
export const MAX_PAGES = 10;
