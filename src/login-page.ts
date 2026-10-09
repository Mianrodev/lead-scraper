// Sign-in page at /login. Also handles first-time setup (creating the first admin with the
// one-time SETUP_CODE) and choosing a new password after an admin reset.

import { FONT_LINKS, THEME_BOOT, THEME_BUTTON, THEME_SCRIPT, themeCss } from "./theme";

export const loginHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Lead Finder</title>
<meta name="theme-color" content="#FBF5EA">
${FONT_LINKS}
${THEME_BOOT}
<style>${themeCss()}
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; color: var(--text);
    background: radial-gradient(900px 500px at 15% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), var(--bg);
    font: 15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
  .top { position: fixed; top: 14px; right: 14px; }
  .card { width: min(400px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 30px; box-shadow: var(--shadow-pop); }
  .mark { display: grid; place-items: center; width: 42px; height: 42px; margin-bottom: 18px; border-radius: 12px; color: var(--invert-text); background: var(--invert-bg);
    font: 700 16px/1 var(--serif); }
  h1 { font: 600 24px/1.2 var(--serif); color: var(--head); margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; font: inherit; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .pw { position: relative; } .pw input { padding-right: 64px; }
  .pw .show { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: auto; margin: 0; padding: 5px 10px; font-size: 12px;
    background: var(--chip); color: var(--text); border-radius: 999px; }
  button { width: 100%; margin-top: 22px; padding: 12px; font: inherit; font-weight: 600; color: var(--on-accent); background: var(--accent); border: none; border-radius: 999px; cursor: pointer; }
  button:hover { filter: brightness(1.06); }
  button:disabled { opacity: .6; }
  /* The message area keeps its place, so the card doesn't jump when an error shows. */
  .msgslot { min-height: 58px; margin-top: 14px; }
  .msg { padding: 10px 12px; border-radius: 10px; background: var(--bad-soft); color: var(--bad); font-size: 13px; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .forgot { margin-top: 10px; text-align: center; }
</style>
</head>
<body>
<div class="top">${THEME_BUTTON}</div>
<main class="card">
  <div class="mark" aria-hidden="true">LF</div>
  <form id="signin" hidden>
    <h1>Lead Finder</h1>
    <p class="lead">Sign in to continue.</p>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <div class="pw"><input id="password" type="password" autocomplete="current-password" required><button type="button" class="show" data-show="password" aria-label="Show the password">Show</button></div>
    <button type="submit" data-busy="Signing in…">Sign in</button>
    <div class="hint forgot">Forgot it? Ask your admin to reset it.</div>
  </form>

  <form id="setup" hidden>
    <h1>Set up Lead Finder</h1>
    <p class="lead">Create the first admin account. You need the one-time setup code.</p>
    <label for="sCode">Setup code</label>
    <input id="sCode" type="password" autocomplete="off" required>
    <label for="sName">Your name</label>
    <input id="sName" type="text" autocomplete="name">
    <label for="sEmail">Email</label>
    <input id="sEmail" type="email" autocomplete="username" required>
    <label for="sPassword">Password</label>
    <div class="pw"><input id="sPassword" type="password" autocomplete="new-password" minlength="10" required><button type="button" class="show" data-show="sPassword" aria-label="Show the password">Show</button></div>
    <div class="hint">At least 10 characters.</div>
    <button type="submit" data-busy="Creating…">Create admin account</button>
  </form>

  <form id="change" hidden>
    <h1>Choose a new password</h1>
    <p class="lead">Your admin set a temporary password. Pick your own to continue.</p>
    <label for="cCurrent">Temporary password</label>
    <div class="pw"><input id="cCurrent" type="password" autocomplete="current-password" required><button type="button" class="show" data-show="cCurrent" aria-label="Show the password">Show</button></div>
    <label for="cNew">New password</label>
    <div class="pw"><input id="cNew" type="password" autocomplete="new-password" minlength="10" required><button type="button" class="show" data-show="cNew" aria-label="Show the password">Show</button></div>
    <div class="hint">At least 10 characters.</div>
    <button type="submit" data-busy="Saving…">Save and continue</button>
  </form>
  <div class="msgslot" aria-live="polite"><div class="msg" id="msg" role="alert" hidden></div></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
function show(id) { ["signin", "setup", "change"].forEach((f) => $(f).hidden = f !== id); const first = $(id).querySelector("input"); if (first) first.focus(); }
function fail(text) { $("msg").hidden = !text; $("msg").textContent = text || ""; }
async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ")");
  return data;
}
// While signing in: the button says so and can't be pressed twice.
function busy(form, on) {
  const b = form.querySelector("button[type=submit]");
  if (!b.dataset.label) b.dataset.label = b.textContent;
  b.disabled = on; b.textContent = on ? (b.dataset.busy || "Please wait…") : b.dataset.label;
}
// Show / Hide: the typing carries on in the password box.
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-show]"); if (!b) return;
  const i = $(b.dataset.show); const hide = i.type === "text"; i.type = hide ? "password" : "text"; b.textContent = hide ? "Show" : "Hide";
  b.setAttribute("aria-label", hide ? "Show the password" : "Hide the password");
  i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (err) { /* fine */ }
});
function done(data) { if (data.mustChangePassword) show("change"); else location.href = "/"; }

$("signin").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { done(await post("/api/auth/login", { email: $("email").value, password: $("password").value })); }
  catch (err) { busy(e.target, false); fail(err.message); }
};
$("setup").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { done(await post("/api/auth/setup", { code: $("sCode").value, name: $("sName").value, email: $("sEmail").value, password: $("sPassword").value })); }
  catch (err) { busy(e.target, false); fail(err.message); }
};
$("change").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { await post("/api/me/password", { current: $("cCurrent").value, next: $("cNew").value }); location.href = "/"; }
  catch (err) { busy(e.target, false); fail(err.message); }
};
fetch("/api/auth/status").then((r) => r.json()).then((s) => show(s.needsSetup ? "setup" : s.mustChangePassword ? "change" : "signin"))
  .catch(() => show("signin"));
</script>
${THEME_SCRIPT}
</body>
</html>`;
