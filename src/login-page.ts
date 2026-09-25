// Sign-in page at /login. Also handles first-time setup (creating the first admin with the
// one-time SETUP_CODE) and choosing a new password after an admin reset.

export const loginHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Lead Finder</title>
<style>
  :root { color-scheme: light; --bg: #f4f5f9; --panel: #fff; --text: #0f172a; --muted: #64748b; --line: #d3d8e2; --accent: #4f46e5; --accent-soft: #eef0ff; --bad: #be123c; --bad-soft: #fff0f3; }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --bg: #0b1020; --panel: #121a2e; --text: #e5e9f2; --muted: #94a0b8; --line: #2e3a57; --accent: #818cf8; --accent-soft: #1e2350; --bad: #fb7185; --bad-soft: #3a1420; }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; color: var(--text);
    background: radial-gradient(900px 500px at 15% -10%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 70%),
      radial-gradient(700px 420px at 110% 110%, color-mix(in srgb, #ec4899 14%, transparent), transparent 70%), var(--bg);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  .card { width: min(400px, 100%); background: var(--panel); border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); border-radius: 18px; padding: 30px;
    box-shadow: 0 20px 50px rgba(15, 23, 42, .12); }
  .card::before { content: "LF"; display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 18px; border-radius: 12px; color: #fff;
    font-weight: 800; font-size: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); box-shadow: 0 6px 16px rgba(99, 102, 241, .35); }
  input { background: var(--panel); color: var(--text); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; font: inherit; border: 1px solid var(--line); border-radius: 10px; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  button { width: 100%; margin-top: 22px; padding: 12px; font: inherit; font-weight: 600; color: #fff; background: linear-gradient(135deg, #4f46e5, #7c3aed); border: none; border-radius: 11px; cursor: pointer; }
  button:disabled { opacity: .6; }
  .msg { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: var(--bad-soft); color: var(--bad); font-size: 13px; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 6px; }
</style>
</head>
<body>
<main class="card">
  <form id="signin" hidden>
    <h1>Lead Finder</h1>
    <p class="lead">Sign in to continue.</p>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
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
    <input id="sPassword" type="password" autocomplete="new-password" minlength="10" required>
    <div class="hint">At least 10 characters.</div>
    <button type="submit">Create admin account</button>
  </form>

  <form id="change" hidden>
    <h1>Choose a new password</h1>
    <p class="lead">Your admin set a temporary password. Pick your own to continue.</p>
    <label for="cCurrent">Temporary password</label>
    <input id="cCurrent" type="password" autocomplete="current-password" required>
    <label for="cNew">New password</label>
    <input id="cNew" type="password" autocomplete="new-password" minlength="10" required>
    <div class="hint">At least 10 characters.</div>
    <button type="submit">Save and continue</button>
  </form>
  <div class="msg" id="msg" hidden></div>
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
function busy(form, on) { form.querySelector("button").disabled = on; }
function done(data) { if (data.mustChangePassword) show("change"); else location.href = "/"; }

$("signin").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { done(await post("/api/auth/login", { email: $("email").value, password: $("password").value })); }
  catch (err) { fail(err.message); } finally { busy(e.target, false); }
};
$("setup").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { done(await post("/api/auth/setup", { code: $("sCode").value, name: $("sName").value, email: $("sEmail").value, password: $("sPassword").value })); }
  catch (err) { fail(err.message); } finally { busy(e.target, false); }
};
$("change").onsubmit = async (e) => {
  e.preventDefault(); busy(e.target, true); fail("");
  try { await post("/api/me/password", { current: $("cCurrent").value, next: $("cNew").value }); location.href = "/"; }
  catch (err) { fail(err.message); } finally { busy(e.target, false); }
};
fetch("/api/auth/status").then((r) => r.json()).then((s) => show(s.needsSetup ? "setup" : s.mustChangePassword ? "change" : "signin"))
  .catch(() => show("signin"));
</script>
</body>
</html>`;
