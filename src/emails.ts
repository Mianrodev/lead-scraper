// Email types, like the lead tools that rate "best email": a person's address (mike@joes.com)
// usually beats a shared inbox (info@joes.com) for cold outreach, and free-mail addresses
// (joesplumbing@gmail.com) are common for small businesses.

export type EmailKind = "personal" | "role" | "freemail";

const ROLE_WORDS = new Set([
  "info", "office", "contact", "contactus", "sales", "admin", "support", "service", "services", "hello", "hi", "team", "booking",
  "bookings", "billing", "accounts", "accounting", "jobs", "careers", "hr", "marketing", "help", "mail", "email", "inquiries",
  "inquiry", "enquiries", "estimates", "estimate", "quotes", "quote", "dispatch", "scheduling", "schedule", "appointments",
  "customerservice", "customercare", "care", "orders", "webmaster", "web", "noreply", "no-reply", "reception", "frontdesk",
  "general", "main", "management", "manager", "owner", "operations", "ops", "payments", "invoices", "service-request", "repairs",
  "warranty", "leads", "newsletter", "press", "media", "privacy", "legal", "compliance", "feedback", "reviews", "social",
]);
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "aol.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "comcast.net", "att.net", "bellsouth.net", "verizon.net", "sbcglobal.net", "cox.net", "charter.net", "earthlink.net",
  "protonmail.com", "proton.me", "ymail.com", "rocketmail.com", "mail.com", "gmx.com", "zoho.com",
]);

/** personal = a person's own address at the business; role = a shared inbox; freemail = Gmail / Yahoo etc. */
export function emailKind(email: string): EmailKind {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  if (FREE_MAIL.has(domain)) return "freemail";
  const word = local.replace(/[0-9]+$/, "");
  // joesplumbing@joesplumbing.com: the business name, not a person.
  const base = domain.split(".").slice(-2, -1)[0] ?? "";
  const bare = word.replace(/[._-]/g, "");
  if (bare.length >= 5 && base && (base.includes(bare) || bare.includes(base))) return "role";
  if (ROLE_WORDS.has(word) || ROLE_WORDS.has(word.replace(/[._-]/g, ""))) return "role";
  // Starts with a role word ("info.orlando", "service-dept"): still a shared inbox.
  if ([...ROLE_WORDS].some((r) => r.length >= 4 && (word.startsWith(r + ".") || word.startsWith(r + "-") || word.startsWith(r + "_")))) return "role";
  return "personal";
}

/** SQL condition over `e.email` for "a person's email" (the plain role words and free-mail domains). */
export function personalEmailSql(): string {
  const list = (s: Set<string>) => [...s].map((x) => `'${x}'`).join(", ");
  return `lower(substr(e.email, 1, instr(e.email, '@') - 1)) NOT IN (${list(ROLE_WORDS)})
    AND lower(substr(e.email, instr(e.email, '@') + 1)) NOT IN (${list(FREE_MAIL)})`;
}

/** Best first: a person's email, then a shared inbox, then free mail (same kind keeps its order). */
export function bestFirst(emails: string[]): string[] {
  const rank: Record<EmailKind, number> = { personal: 0, role: 1, freemail: 2 };
  return emails.map((e, i) => ({ e, i, r: rank[emailKind(e)] })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e);
}

/** "Mike" from mike@…, mike.smith@…, mike_s@… (for a cold-email first name); "" when it isn't a name. */
export function firstNameFrom(email: string): string {
  if (emailKind(email) !== "personal") return "";
  const part = email.split("@")[0].split(/[._-]/)[0].replace(/[0-9]+/g, "");
  return part.length >= 3 && part.length <= 12 && /^[a-z]+$/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "";
}
