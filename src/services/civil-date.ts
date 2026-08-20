const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validateTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
}

export function civilDateInTimeZone(timeZone = systemTimeZone(), now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validateTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftCivilDate(date: string, days: number): string {
  const match = CIVIL_DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid civil date: ${date}`);
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.toISOString().slice(0, 10) !== date) throw new Error(`Invalid civil date: ${date}`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function resolveCivilDate(value: string, timeZone?: string, now = new Date()): string {
  return value === "today" ? civilDateInTimeZone(timeZone ?? systemTimeZone(), now) : value;
}
