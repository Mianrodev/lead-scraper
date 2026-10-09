// Ready-made openers (no AI, free): a personal first line, an email, a text and a call script
// for each business, built from what the website check and scores found. The team can edit
// the wording on the Admin page; {merge fields} are filled per business.

import { ownerFirstName } from "./emails";

export interface OpenerTemplates { subject: string; email: string; sms: string; call: string }

export const DEFAULT_TEMPLATES: OpenerTemplates = {
  subject: "Quick idea for {business}",
  email: "Hi {first_name},\n\nI was looking at {business} online and noticed {problem}. For {category_plural} in {city}, that usually means calls going to competitors.\n\n{second_line}We help local businesses fix exactly this. Would a quick 10-minute call this week be useful?\n\n{signature}",
  sms: "Hi {first_name}, it's {agency} here. I noticed {problem} for {business}. We fix that for local {category_plural}. Open to a quick chat?",
  call: "Hi, is this {first_name}? This is [your name] with {agency}. I was looking at {business} online and noticed {problem}. {second_line}Would you be open to a quick look at how we'd fix it?",
};

export const MERGE_FIELDS = ["first_name", "business", "city", "category", "category_plural", "problem", "second_line", "agency", "signature"];

// A suggestion from the scores (src/scoring.ts) -> how to say it to the owner.
const PHRASES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^They pay for ads, but visitors can't book/i, () => "you're paying for ads, but visitors can't book or send a request on your website"],
  [/^Close the review gap: (.+) nearby has ([\d,]+) reviews, this business (\d+)/i, (m) => `${m[1]} has ${m[2]} Google reviews to your ${m[3]}`],
  [/^Add a website/i, () => "I couldn't find a website for you"],
  [/^Build a real website/i, () => "you're relying on a social media page instead of your own website"],
  [/^Build a new website: their domain is parked/i, () => "your web address is showing a parked page instead of your business"],
  [/^Fix the website: it doesn't load/i, () => "your website isn't loading right now"],
  [/^Refresh the website/i, () => "your website looks a few years out of date"],
  [/^Make the website work on phones/i, () => "your website is hard to use on a phone, where most people search"],
  [/^Renew the security certificate/i, () => "your website's security certificate is about to expire, so browsers will start warning visitors"],
  [/^Add online booking/i, () => "customers can't book with you online"],
  [/^Add a contact form/i, () => "there's no quick way to send you a request from your website"],
  [/^Move the website to https/i, () => "browsers mark your website as not secure"],
  [/^Add a Meta pixel/i, () => "you're not set up to reach people again after they visit your website"],
  [/^Speed up the website/i, () => "your website loads slowly on phones"],
  [/^Add a chat widget/i, () => "visitors can't ask a quick question on your website"],
  [/^Set up email on their own domain/i, () => "you don't have email on your own web address"],
  [/^Claim and verify the Google profile/i, () => "your Google profile isn't verified"],
  [/^(Get the first Google reviews|Ask happy customers for reviews)/i, () => "you have very few Google reviews"],
  [/^Add opening hours/i, () => "your Google listing doesn't show opening hours"],
  [/^Add photos/i, () => "your Google listing has hardly any photos"],
  [/^Reply to reviews/i, () => "a few reviews on your Google listing are pulling your rating down"],
  [/^Add a business description/i, () => "your Google listing has no description"],
];

export function problemPhrase(suggestion: string | undefined): string | null {
  if (!suggestion) return null;
  for (const [re, say] of PHRASES) {
    const m = suggestion.match(re);
    if (m) return say(m);
  }
  return null;
}

// Words that keep their capital inside a sentence ("Italian restaurant" -> "Italian restaurants").
const PROPER_WORDS = new Set([
  "american", "african", "asian", "brazilian", "british", "cajun", "caribbean", "chinese", "cuban", "ethiopian", "european", "filipino",
  "french", "german", "greek", "haitian", "hawaiian", "hispanic", "indian", "irish", "italian", "jamaican", "japanese", "korean", "latin",
  "lebanese", "mediterranean", "mexican", "moroccan", "persian", "peruvian", "polish", "portuguese", "puerto", "rican",
  "russian", "spanish", "thai", "turkish", "vietnamese", "venezuelan", "colombian", "salvadoran", "dominican", "christian", "catholic",
  "baptist", "methodist", "lutheran", "pentecostal", "presbyterian", "episcopal", "jewish", "islamic", "buddhist", "hindu", "sikh",
  "pilates", "botox", "medicare", "medicaid", "ford", "toyota", "honda", "chevrolet", "nissan", "hyundai", "kia", "bmw", "mercedes",
  "volkswagen", "subaru", "jeep", "dodge", "lexus", "audi", "tesla", "mazda", "mitsubishi", "volvo", "harley", "samsung",
]);
// Short words written in capitals ("HVAC contractor", "CPA", "DJ service", "BBQ restaurant").
const ACRONYMS = new Set(["hvac", "cpa", "dj", "bbq", "atv", "rv", "mri", "ent", "cpr", "ems", "emt", "suv", "pc", "tv", "diy", "ev", "lgbt", "lgbtq", "ada", "ceo", "seo", "gps", "dui", "dmv", "cbd", "ymca", "usps"]);

/**
 * A business type as it reads inside a sentence: "HVAC contractor" stays "HVAC contractor",
 * "Plumber" -> "plumber", "Italian restaurant" stays "Italian restaurant", "hvac_contractor" ->
 * "HVAC contractor".
 */
export function categoryWords(category: string | null | undefined): string {
  const c = (category ?? "").trim().replace(/_/g, " ").replace(/\s+/g, " ");
  if (!c) return "";
  const shouting = c === c.toUpperCase(); // "ROOFING CONTRACTOR": capitals say nothing
  return c.split(" ").map((w, i) => {
    const bare = w.toLowerCase().replace(/[^a-z]/g, "");
    if (ACRONYMS.has(bare)) return w.toUpperCase();
    if (!shouting && /^[A-Z][A-Z0-9&]{1,4}$/.test(w)) return w; // written as an acronym already ("IT", "AC")
    if (PROPER_WORDS.has(bare)) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    // Words after the first keep a capital they were given ("Toyota dealer", "iPhone repair").
    if (!shouting && i > 0 && /[A-Z]/.test(w)) return w;
    return w.toLowerCase();
  }).join(" ");
}

export function pluralCategory(category: string | null): string {
  const c = categoryWords(category ?? "local business") || "local business";
  if (/(ss|sh|ch|x|z)$/i.test(c)) return `${c}es`;
  if (/[^aeiou]y$/i.test(c)) return `${c.slice(0, -1)}ies`;
  if (/[A-Z]$/.test(c)) return `${c}s`; // "CPAs"
  return /s$/i.test(c) ? c : `${c}s`;
}

export interface OpenerInput {
  business: string | null; ownerName: string | null; firstNameFromEmail?: string; city: string | null; category: string | null; suggestions: string[];
  agency: { name: string; phone: string; email: string; website: string };
}

export interface Opener { firstLine: string; subject: string; email: string; sms: string; call: string }

/** Without an agency name: "it's {agency} here", "with {agency}" and a signature are left out, never "our team". */
function withoutAgency(s: string): string {
  return s
    .replace(/,?\s*(?:it's|it is|this is)\s+\{agency\}\s+here([.!,])\s*/gi, (_m, p: string) => (p === "," ? ", " : ", "))
    .replace(/\s+(?:with|from|at)\s+\{agency\}/gi, "")
    .replace(/\{agency\}\s+/gi, "We ")
    .replace(/\{agency\}/gi, "us");
}

export function buildOpener(i: OpenerInput, t: OpenerTemplates = DEFAULT_TEMPLATES): Opener {
  const phrases = i.suggestions.map(problemPhrase).filter((p): p is string => !!p);
  // A first name only from the owner's name, or an email that reads as a person's ("Hi there" otherwise).
  const first = ownerFirstName(i.ownerName) || i.firstNameFromEmail || "there";
  const problem = phrases[0] ?? "a few quick wins in how you show up online";
  const second = phrases[1] ? `I also noticed ${phrases[1]}. ` : "";
  const agencyName = (i.agency.name ?? "").trim();
  const website = (i.agency.website ?? "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  // No agency name: no made-up signature (the sender's own email signature does the job).
  const signature = agencyName ? [agencyName, i.agency.phone, website].filter(Boolean).join("\n") : "";
  // A business name that already ends with "." ("Smith & Co.") doesn't get a second one.
  const business = (i.business ?? "").trim() || "your business";
  const values: Record<string, string> = {
    first_name: first, business, city: i.city ?? "your area", category: categoryWords(i.category) || "business",
    category_plural: pluralCategory(i.category), problem, second_line: second, agency: agencyName, signature,
  };
  const fill = (raw: string) => {
    const s = agencyName ? raw : withoutAgency(raw);
    return s.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? values[k] : all))
      .replace(/(?<!\.)\.\.(?!\.)/g, ".")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };
  return {
    firstLine: fill(`I was looking at {business} online and noticed {problem}.`),
    subject: fill(t.subject), email: fill(t.email), sms: fill(t.sms), call: fill(t.call),
  };
}

export function cleanTemplates(v: unknown): OpenerTemplates {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: keyof OpenerTemplates, max: number) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).slice(0, max) : DEFAULT_TEMPLATES[k]);
  return { subject: s("subject", 200), email: s("email", 3000), sms: s("sms", 600), call: s("call", 3000) };
}

export async function loadTemplates(env: Env): Promise<OpenerTemplates> {
  const v = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'opener_templates'`).first<string>("value");
  try { return cleanTemplates(v ? JSON.parse(v) : null); } catch { return DEFAULT_TEMPLATES; }
}

export async function saveTemplates(env: Env, v: unknown): Promise<OpenerTemplates> {
  const t = cleanTemplates(v);
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('opener_templates', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(t)).run();
  return t;
}
