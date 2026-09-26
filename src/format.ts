// Date formats used by the existing GHL upload sheet.

/** `M/D/YYYY`, e.g. `8/25/2026`. */
export function formatLeadDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** `M/D/YYYY H:MM AM/PM`, e.g. `8/25/2026 3:30 PM`. */
export function formatLeadDateTime(date: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  // Some ICU builds use a narrow no-break space before AM/PM.
  return `${formatLeadDate(date, timeZone)} ${time.replace(/ | /g, " ")}`;
}

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const VALID_CODES = new Set(Object.values(STATE_CODES));

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/, "of");

/** All US states (plus DC and Puerto Rico) as { code, name }, sorted by name. */
export const US_STATES = Object.entries(STATE_CODES)
  .map(([name, code]) => ({ code, name: titleCase(name) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** "FL" -> "Florida". Unknown codes are returned unchanged. */
export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return US_STATES.find((s) => s.code === code.toUpperCase())?.name ?? code;
}

/** "Florida" / "florida" / "FL" -> "FL". Anything unrecognised is returned unchanged. */
export function stateCode(state: string | null | undefined): string | null {
  if (!state?.trim()) return null;
  const s = state.trim();
  if (s.length === 2 && VALID_CODES.has(s.toUpperCase())) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase().replace(/\./g, "")] ?? s;
}

/** Pulls city + state out of a US street address ending "…, City, State 12345[, United States]". */
export function cityStateFromAddress(address: string | null): { city: string | null; state: string | null } {
  const m = address?.match(/,\s*([^,]+?),\s*([A-Za-z .]+?)\s+\d{5}(?:-\d{4})?(?:,\s*(?:USA|United States))?\s*$/);
  return m ? { city: m[1].trim(), state: stateCode(m[2]) } : { city: null, state: null };
}

/** Splits "Orlando, FL" / "Orlando FL" into city + state. */
export function parseCityState(input: string, explicitState?: string | null): { city: string; state: string | null } {
  const cleaned = input.trim().replace(/\s+/g, " ");
  const normState = (s: string) => stateCode(s) ?? s;
  if (explicitState?.trim()) return { city: cleaned.replace(/,\s*$/, ""), state: normState(explicitState.trim()) };
  const comma = cleaned.match(/^(.+?),\s*([A-Za-z .]+)$/);
  if (comma) return { city: comma[1].trim(), state: normState(comma[2].trim()) };
  const trailingCode = cleaned.match(/^(.+?)\s+([A-Za-z]{2})$/);
  if (trailingCode) return { city: trailingCode[1].trim(), state: trailingCode[2].toUpperCase() };
  return { city: cleaned, state: null };
}

/**
 * Start of a calendar day ("2026-09-25") in a timezone, as a UTC "YYYY-MM-DD HH:MM:SS" string
 * (how the database stores times). plusDays moves to a later day, e.g. 1 for "the end of that day".
 */
export function zonedDayStartUtc(ymd: string, timeZone: string, plusDays = 0): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + plusDays));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString().slice(0, 19).replace("T", " ");
}
