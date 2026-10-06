// Spam protection (Cloudflare Turnstile) on sign-up and "forgot password". Off until both
// TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set on the store Worker.
import { StoreError, type StoreEnv } from "./types";

export function turnstileOn(env: StoreEnv): boolean {
  return !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY;
}

/** Throws a plain message when the check is on and didn't pass. */
export async function checkTurnstile(env: StoreEnv, token: unknown, ip: string) {
  if (!turnstileOn(env)) return;
  const t = typeof token === "string" ? token : "";
  if (!t) throw new StoreError("Please tick the “I'm human” check, then try again.", 400);
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY!);
  body.append("response", t.slice(0, 2048));
  if (ip && ip !== "local") body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { success?: boolean }) : {};
  if (!data.success) throw new StoreError("The “I'm human” check didn't pass. Please try it again.", 400);
}
