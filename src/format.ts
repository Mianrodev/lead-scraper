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

/** Splits "Orlando, FL" / "Orlando FL" into city + state. */
export function parseCityState(input: string, explicitState?: string | null): { city: string; state: string | null } {
  const cleaned = input.trim().replace(/\s+/g, " ");
  const normState = (s: string) => (s.length === 2 ? s.toUpperCase() : s);
  if (explicitState?.trim()) return { city: cleaned.replace(/,\s*$/, ""), state: normState(explicitState.trim()) };
  const comma = cleaned.match(/^(.+?),\s*([A-Za-z .]+)$/);
  if (comma) return { city: comma[1].trim(), state: normState(comma[2].trim()) };
  const trailingCode = cleaned.match(/^(.+?)\s+([A-Za-z]{2})$/);
  if (trailingCode) return { city: trailingCode[1].trim(), state: trailingCode[2].toUpperCase() };
  return { city: cleaned, state: null };
}
