// Sign-in page at /login. Also handles first-time setup (creating the first admin with the
// one-time SETUP_CODE) and choosing a new password after an admin reset.

export const loginHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Lead Finder</title>
<style>
  :root { --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #667085; --line: #d0d5dd; --accent: #2563eb; --accent-soft: #eff4ff; --bad: #b42318; --bad-soft: #fef3f2; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width: min(400px, 100%); background: var(--panel); border: 1px solid #e4e7ec; border-radius: 16px; padding: 28px; box-shadow: 0 12px 32px rgba(16,24,40,.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; font: inherit; border: 1px solid var(--line); border-radius: 10px; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  button { width: 100%; margin-top: 20px; padding: 11px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: none; border-radius: 10px; cursor: pointer; }
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
