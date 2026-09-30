// Demo website: "here's what your website could look like", built from what we know about a
// business (name, type, city, phone, rating). Public at /d/<token> (random, unguessable,
// not indexed), with a banner saying it's a preview made by the agency.

import type { AgencySettings } from "./report";

export interface LeadForDemo {
  business_name: string | null; gbp_category: string | null; industry: string | null; city: string | null; state: string | null;
  gbp_phone_formatted: string | null; rating: number | null; review_count: number | null; address: string | null; owner_name: string | null;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Services and a colour per kind of business (by words in its type); a general set otherwise.
const KINDS: { match: RegExp; color: string; services: string[] }[] = [
  { match: /plumb|drain|septic|water heater|rooter/i, color: "#0e5ea8", services: ["Leak detection & repair", "Drain cleaning", "Water heaters", "Repiping", "Fixture installation", "24/7 emergency service"] },
  { match: /hvac|air condition|heating|furnace|cooling|duct/i, color: "#0f7a6c", services: ["AC repair", "New system installation", "Heating repair", "Maintenance plans", "Duct cleaning", "Indoor air quality"] },
  { match: /roof|gutter|siding/i, color: "#8a3b12", services: ["Roof repair", "Roof replacement", "Storm damage", "Inspections", "Gutters", "Free estimates"] },
  { match: /electric/i, color: "#b7791f", services: ["Panel upgrades", "Wiring & rewiring", "Lighting", "Generators", "EV chargers", "Safety inspections"] },
  { match: /landscap|lawn|garden|tree|irrigation/i, color: "#2f7d32", services: ["Lawn care", "Landscape design", "Tree trimming", "Irrigation", "Mulch & planting", "Seasonal clean-ups"] },
  { match: /clean|janitor|maid|pressure wash|window/i, color: "#2563eb", services: ["Home cleaning", "Deep cleaning", "Move-in / move-out", "Office cleaning", "Pressure washing", "Recurring service"] },
  { match: /pest|termite|exterminat/i, color: "#6b3fa0", services: ["General pest control", "Termites", "Rodents", "Mosquitoes", "Inspections", "Prevention plans"] },
  { match: /pool|spa|hot tub/i, color: "#0891b2", services: ["Weekly pool service", "Repairs", "Equipment", "Green-to-clean", "Resurfacing", "Inspections"] },
  { match: /paint/i, color: "#be123c", services: ["Interior painting", "Exterior painting", "Cabinets", "Drywall repair", "Pressure washing", "Color consultation"] },
  { match: /locksmith/i, color: "#374151", services: ["Lockouts", "Rekeying", "New locks", "Smart locks", "Car keys", "24/7 service"] },
  { match: /garage door/i, color: "#475569", services: ["Spring repair", "Openers", "New doors", "Off-track repair", "Maintenance", "Same-day service"] },
  { match: /mov(er|ing)|junk|haul|dumpster/i, color: "#c2410c", services: ["Local moves", "Long distance", "Packing", "Junk removal", "Storage", "Free quotes"] },
];

function kindFor(l: LeadForDemo) {
  const text = `${l.gbp_category ?? ""} ${l.industry ?? ""}`;
  return KINDS.find((k) => k.match.test(text)) ?? { color: "#1f4e8c", services: ["Free estimates", "Licensed & insured", "Fast response", "Upfront pricing", "Local experts", "Satisfaction guaranteed"] };
}

export function renderDemo(l: LeadForDemo, agency: AgencySettings): string {
  const k = kindFor(l);
  const name = l.business_name ?? "Your Business";
  const where = [l.city, l.state].filter(Boolean).join(", ");
  const type = l.gbp_category ?? "Local service";
  const tel = (l.gbp_phone_formatted ?? "").replace(/[^\d+]/g, "");
  const phoneText = l.gbp_phone_formatted ? l.gbp_phone_formatted.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "";
  const stars = l.rating && l.review_count ? `<div class="stars">${"★".repeat(Math.round(l.rating))}<span> ${l.rating.toFixed(1)} from ${l.review_count} Google reviews</span></div>` : "";
  const agencyContact = [agency.phone, agency.email].filter(Boolean).map(esc).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(name)} · ${esc(type)}${where ? ` in ${esc(where)}` : ""}</title>
<style>
  :root { --c: ${k.color}; color-scheme: light; }
  * { box-sizing: border-box; } body { margin: 0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2230; background: #fff; }
  a { color: inherit; }
  .preview { background: #111827; color: #e5e7eb; font-size: 13px; padding: 8px 16px; text-align: center; }
  .preview b { color: #fff; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; max-width: 1080px; margin: 0 auto; }
  .logo { font-weight: 800; font-size: 20px; color: var(--c); } .call { background: var(--c); color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 10px; font-weight: 700; }
  .hero { background: linear-gradient(135deg, var(--c), #0b1220); color: #fff; padding: 70px 20px; }
  .hero .in { max-width: 1080px; margin: 0 auto; } .hero h1 { font-size: clamp(30px, 5vw, 48px); line-height: 1.1; margin: 0 0 12px; }
  .hero p { font-size: 19px; max-width: 620px; opacity: .92; } .btns { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; }
  .btn { display: inline-block; padding: 13px 22px; border-radius: 12px; font-weight: 700; text-decoration: none; }
  .btn.w { background: #fff; color: var(--c); } .btn.o { border: 2px solid #fff; color: #fff; }
  .stars { color: #fbbf24; margin-top: 14px; font-size: 20px; } .stars span { color: #fff; font-size: 15px; }
  section { max-width: 1080px; margin: 0 auto; padding: 56px 20px; } h2 { font-size: 28px; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .svc { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; } .svc b { display: block; margin-bottom: 4px; }
  .why { background: #f5f7fb; } .why .in { max-width: 1080px; margin: 0 auto; }
  form { display: grid; gap: 10px; max-width: 520px; } input, textarea { font: inherit; padding: 11px 12px; border: 1px solid #cfd5e1; border-radius: 10px; }
  form button { background: var(--c); color: #fff; border: none; padding: 13px; border-radius: 10px; font-weight: 700; font: inherit; cursor: pointer; }
  footer { background: #0b1220; color: #cbd5e1; padding: 28px 20px; text-align: center; font-size: 14px; }
  .made { background: #fff7ed; border-top: 1px solid #fed7aa; padding: 18px 20px; text-align: center; font-size: 15px; }
</style></head><body>
<div class="preview"><b>Preview</b> made for ${esc(name)} by ${esc(agency.name || "our team")}. This isn't live yet.</div>
<header><div class="logo">${esc(name)}</div>${tel ? `<a class="call" href="tel:${esc(tel)}">Call ${esc(phoneText)}</a>` : ""}</header>
<div class="hero"><div class="in">
  <h1>${esc(type)}${where ? ` in ${esc(where)}` : ""}</h1>
  <p>${esc(name)} is your local ${esc(type.toLowerCase())}${where ? ` serving ${esc(where)} and nearby` : ""}. Fast, friendly, and done right the first time.</p>
  <div class="btns"><a class="btn w" href="#quote">Get a free quote</a>${tel ? `<a class="btn o" href="tel:${esc(tel)}">Call now</a>` : ""}</div>
  ${stars}
</div></div>
<section><h2>What we do</h2><div class="grid">${k.services.map((s) => `<div class="svc"><b>${esc(s)}</b><span>Done by local pros${where ? ` in ${esc(l.city ?? where)}` : ""}.</span></div>`).join("")}</div></section>
<div class="why"><section><h2>Why ${esc(name)}</h2><div class="grid">
  <div class="svc"><b>Local and trusted</b>Neighbours${l.review_count ? ` gave us ${l.review_count} Google reviews` : " recommend us"}.</div>
  <div class="svc"><b>Upfront pricing</b>No surprises. You approve the price before we start.</div>
  <div class="svc"><b>Book in a minute</b>Request a visit online, any time of day.</div>
</div></section></div>
<section id="quote"><h2>Get a free quote</h2>
  <form onsubmit="alert('This is a preview: in the live website, this request goes straight to ${esc(name.replace(/['"\\<>&\r\n]/g, ""))}.'); return false;">
    <input placeholder="Your name" required><input placeholder="Phone or email" required><textarea rows="3" placeholder="What do you need help with?"></textarea>
    <button type="submit">Send my request</button>
  </form>
</section>
<div class="made">Like it? ${esc(agency.name || "We")} can have this live for ${esc(name)} with online booking and your own photos. ${agencyContact}</div>
<footer>${esc(name)}${l.address ? ` · ${esc(l.address)}` : where ? ` · ${esc(where)}` : ""}${phoneText ? ` · ${esc(phoneText)}` : ""}</footer>
</body></html>`;
}

function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function ensureDemoToken(env: Env, leadId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT demo_token FROM leads WHERE id = ?`).bind(leadId).first<{ demo_token: string | null }>();
  if (!row) return null;
  if (row.demo_token) return row.demo_token;
  await env.DB.prepare(`UPDATE leads SET demo_token = ? WHERE id = ? AND demo_token IS NULL`).bind(token(), leadId).run();
  return env.DB.prepare(`SELECT demo_token FROM leads WHERE id = ?`).bind(leadId).first<string>("demo_token");
}

export async function demoLead(env: Env, t: string): Promise<(LeadForDemo & { id: string }) | null> {
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  return env.DB.prepare(
    `SELECT id, business_name, gbp_category, industry, city, state, gbp_phone_formatted, rating, review_count, address, owner_name FROM leads WHERE demo_token = ?`,
  ).bind(t).first<LeadForDemo & { id: string }>();
}
