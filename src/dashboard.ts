// Single-page dashboard served at "/". Plain HTML + JS, no build step.
// Flow: start empty -> pick where + what -> "Find leads" reuses stored pulls and only
// pulls (and pays for) what's missing -> filter the results with Targetron-style dropdowns.

export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Finder</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f4f5f9; --panel: #ffffff; --panel-2: #f9fafc; --chip: #f1f3f8; --text: #0f172a; --muted: #64748b; --line: #e6e9f0; --line-strong: #d3d8e2;
    --accent: #4f46e5; --accent-strong: #3730a3; --accent-soft: #eef0ff; --accent-line: #c7cbfb;
    --ok: #047857; --ok-soft: #e9f9f1; --warn: #b45309; --warn-soft: #fff6e5; --bad: #be123c; --bad-soft: #fff0f3;
    --shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 2px 8px rgba(15, 23, 42, .05);
    --radius: 14px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0b1020; --panel: #121a2e; --panel-2: #0f1627; --chip: #1c2640; --text: #e5e9f2; --muted: #94a0b8; --line: #222c44; --line-strong: #2e3a57;
      --accent: #818cf8; --accent-strong: #c7d2fe; --accent-soft: #1e2350; --accent-line: #3b418a;
      --ok: #34d399; --ok-soft: #0f2e25; --warn: #fbbf24; --warn-soft: #33260b; --bad: #fb7185; --bad-soft: #3a1420;
      --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 4px 14px rgba(0, 0, 0, .25);
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--panel) 88%, transparent); backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line); padding: 10px 24px; display: flex; align-items: center; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 13px; letter-spacing: -.02em;
    background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #ec4899); box-shadow: 0 4px 12px rgba(99, 102, 241, .35); }
  h1 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
  h1 small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
  h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: -.01em; }
  .tabs { display: flex; gap: 2px; background: var(--chip); padding: 3px; border-radius: 11px; }
  .tab { padding: 6px 14px; border: none; border-radius: 8px; cursor: pointer; color: var(--muted); background: none; font: inherit; font-weight: 500; }
  .tab:hover { color: var(--text); }
  .tab.active { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, .12); }
  main { padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1480px; margin: 0 auto; }
  .pagehead h2 { font-size: 22px; margin: 4px 0 2px; letter-spacing: -.02em; }
  .pagehead p { margin: 0; color: var(--muted); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); }
  input, select, button { font: inherit; }
  input[type=text], input[type=number], input[type=date], input[type=password], select { padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 9px;
    background: var(--panel); color: var(--text); transition: border-color .12s, box-shadow .12s; }
  input:focus-visible, select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  button { padding: 8px 15px; border-radius: 9px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; font-weight: 600;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .08); transition: filter .12s, background .12s, border-color .12s; }
  button:hover { filter: brightness(1.06); }
  button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
  button.ghost { background: var(--panel); color: var(--text); border-color: var(--line-strong); font-weight: 500; }
  button.ghost:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
  button.danger:hover { border-color: var(--bad); color: var(--bad); }
  button.link { background: none; border: none; color: var(--accent); padding: 0; box-shadow: none; font-weight: 500; }
  button.small { padding: 4px 10px; font-size: 12px; border-radius: 8px; }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  .muted { color: var(--muted); } .hint { font-size: 12px; color: var(--muted); }
  .err { color: var(--bad); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  code { font-size: 12px; background: var(--chip); padding: 1px 5px; border-radius: 5px; }
  /* Search builder */
  .builder { display: grid; grid-template-columns: 96px 1fr; gap: 12px 14px; align-items: start; }
  .builder > .lbl { font-weight: 600; font-size: 13px; padding-top: 7px; }
  .line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; padding: 4px 6px; min-width: 260px; background: var(--panel); }
  .tags input { border: none; outline: none; padding: 3px; min-width: 160px; flex: 1; }
  .tag { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 2px 4px 2px 9px; font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .tag button { background: none; border: none; color: inherit; padding: 0 4px; cursor: pointer; font-size: 13px; line-height: 1; }

  /* "What" button + picks */
  .picked { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .me { margin-left: auto; align-self: center; display: flex; gap: 12px; align-items: center; font-size: 13px; color: var(--muted); padding-bottom: 8px; }
  .spend { font-size: 12px; padding: 3px 9px; border-radius: 99px; background: var(--bg); white-space: nowrap; }
  .spend.warn { background: var(--warn-soft); color: var(--warn); } .spend.bad { background: var(--bad-soft); color: var(--bad); }
  .bellwrap { position: relative; }
  .bell { background: none; border: 1px solid var(--line-strong); border-radius: 99px; padding: 3px 9px; color: var(--text); position: relative; }
  .bell .badge { position: absolute; top: -6px; right: -6px; background: var(--bad); color: #fff; border-radius: 99px; font-size: 11px; padding: 0 6px; font-weight: 700; }
  .bellpanel { position: absolute; right: 0; top: calc(100% + 6px); width: min(380px, 92vw); max-height: 420px; overflow-y: auto; background: var(--panel); border: 1px solid var(--line-strong);
    border-radius: 12px; box-shadow: 0 12px 32px rgba(16,24,40,.16); z-index: 40; padding: 6px; }
  .note { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 8px; font-size: 13px; color: var(--text); }
  .note + .note { border-top: 1px solid var(--line); }
  .note .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--warn); }
  .note.error .dot { background: var(--bad); } .note.info .dot { background: var(--accent); }
  .note .when { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .note button { margin-left: auto; flex: none; }
  #whatBtn { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 99px; }
  #whatBtn.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); font-weight: 600; }

  /* Category picker: a centered pop-up window over the page */
  .modal-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(16, 24, 40, .45); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal { width: min(1120px, 100%); height: min(780px, 100%); background: var(--panel); border-radius: 16px; box-shadow: 0 24px 64px rgba(16, 24, 40, .28);
    display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
  .modal-head { padding: 18px 22px 14px; border-bottom: 1px solid var(--line); }
  .modal-head .title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .modal-head h2 { font-size: 18px; margin: 0; }
  .modal-head .x { background: none; border: none; color: var(--muted); font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 8px; }
  .modal-head .x:hover { background: var(--bg); color: var(--text); }
  .searchrow { display: flex; gap: 10px; align-items: center; }
  .searchbox { flex: 1; position: relative; }
  .searchbox input { width: 100%; padding: 11px 14px 11px 38px; font-size: 15px; border-radius: 10px; border: 1px solid var(--line-strong); }
  .searchbox input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .searchbox::before { content: "⌕"; position: absolute; left: 13px; top: 50%; transform: translateY(-52%); font-size: 18px; color: var(--muted); }
  .pill-btn { border-radius: 99px; padding: 9px 14px; background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); white-space: nowrap; }
  .pill-btn:hover { border-color: var(--accent-line); color: var(--accent); }
  .modal-body { display: grid; grid-template-columns: 290px 1fr; min-height: 0; }
  .side { border-right: 1px solid var(--line); overflow-y: auto; padding: 8px 10px 16px; background: var(--panel-2); }
  .side .gtitle { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--text); margin: 14px 8px 6px; }
  .side .gtitle .ico { width: 26px; height: 26px; border-radius: 8px; background: var(--bg); display: grid; place-items: center; font-size: 14px; }
  .side .sec { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 10px 7px 42px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--text); }
  .side .sec:hover { background: var(--bg); }
  .side .sec.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .side .cnt { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .side .cnt.some { background: var(--accent); color: #fff; border-radius: 99px; padding: 1px 7px; font-weight: 700; }
  .main { overflow-y: auto; padding: 20px 24px 28px; }
  .main .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
  .main h3 { font-size: 20px; margin: 0 0 2px; }
  .main .sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 20px 0 10px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .tile { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line-strong); border-radius: 10px; padding: 11px 12px; cursor: pointer;
    background: var(--panel); text-align: left; font-size: 14px; color: var(--text); line-height: 1.3; transition: border-color .12s, background .12s; }
  .tile:hover { border-color: var(--accent-line); background: var(--accent-soft); }
  .tile .tick { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--line-strong); display: grid; place-items: center; font-size: 11px; color: #fff; }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .tile.on .tick { background: var(--accent); border-color: var(--accent); }
  .tile .star { margin-left: auto; color: #f79009; font-size: 12px; }
  .showall { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 8px 14px; border-radius: 99px; background: var(--bg); color: var(--accent); border: none; font-weight: 600; }
  .alllist { columns: 3 220px; column-gap: 22px; margin-top: 4px; }
  .alllist label { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; break-inside: avoid; font-size: 13px; cursor: pointer; }
  .alllist input { margin-top: 2px; accent-color: var(--accent); }
  .alllist .in { color: var(--muted); font-size: 11px; }
  .modal-foot { display: flex; align-items: center; gap: 12px; padding: 12px 22px; border-top: 1px solid var(--line); background: var(--panel-2); }
  .modal-foot .chosen { flex: 1; display: flex; gap: 6px; overflow-x: auto; white-space: nowrap; align-items: center; min-height: 30px; }
  .modal-foot .done { padding: 9px 20px; border-radius: 10px; font-weight: 600; }
  @media (max-width: 760px) { .modal-body { grid-template-columns: 1fr; grid-template-rows: 200px 1fr; } .side { border-right: none; border-bottom: 1px solid var(--line); } }

  /* Plan */
  .plan table { margin: 8px 0; }
  .plan .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

  /* Dropdown chips (multi-select) */
  .filterbar { display: flex; flex-direction: column; gap: 8px; }
  .fgroup { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .fgroup > .glabel { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); width: 88px; flex: none; }
  .dd { position: relative; }
  .dd > .chip { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); border-radius: 99px; padding: 4px 11px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  .dd > .chip.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }
  .dd > .chip::after { content: "▾"; font-size: 10px; opacity: .7; }
  .pop { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 290px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 10px;
    box-shadow: 0 8px 24px rgba(16,24,40,.12); padding: 8px; display: none; }
  .dd.open .pop { display: block; }
  .pop .search { width: 100%; margin-bottom: 6px; }
  .pop .bulk { display: flex; justify-content: space-between; font-size: 12px; padding: 0 2px 6px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .pop .opts { max-height: 300px; overflow-y: auto; }
  .pop .opt { display: flex; gap: 7px; align-items: center; padding: 4px 4px; border-radius: 6px; cursor: pointer; }
  .pop .opt:hover { background: var(--bg); }
  .pop .opt .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .pop .grp { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .03em; color: var(--muted); padding: 8px 4px 3px; }
  .pop .grp button { font-size: 11px; text-transform: none; letter-spacing: 0; font-weight: 500; }
  .pop .empty { padding: 10px; color: var(--muted); font-size: 13px; }
  .pop .dates { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; font-size: 13px; }

  /* Results */
  .results { padding: 0; overflow: hidden; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .scope { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: var(--chip); color: var(--muted); }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--panel-2); }
  th[data-sort] { cursor: pointer; user-select: none; }
  th.sorted::after { content: " ▾"; } th.sorted.asc::after { content: " ▴"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  .type-mobile { color: var(--ok); } .type-toll_free { color: #6941c6; } .type-landline { color: #175cd3; }
  .empty-state { text-align: center; padding: 56px 20px; color: var(--muted); }
  .empty-state strong { display: block; color: var(--text); font-size: 16px; margin-bottom: 6px; }
  .history-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  @media (max-width: 760px) { .builder { grid-template-columns: 1fr; } .fgroup > .glabel { width: 100%; } }

  /* Phones and small tablets */
  @media (max-width: 760px) {
    header { flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px 0; }
    header h1 { margin-bottom: 4px; }
    .me { order: 2; margin-left: auto; padding-bottom: 4px; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .tabs { order: 3; width: 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
    .tab { white-space: nowrap; padding: 8px 12px; }
    main { padding: 10px 10px 32px; gap: 10px; }
    .card { padding: 12px; border-radius: 12px; }
    .builder > .lbl { padding-top: 0; }
    .line > * { max-width: 100%; }
    .line select, .line input[type=text] { max-width: 100%; }
    .fgroup { gap: 6px; }
    .dd .pop { position: fixed; left: 8px !important; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 70vh; }
    .bar { padding: 10px; }
    /* Results: one card per business */
    .results table thead { display: none; }
    #rows tr { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; padding: 12px; border-bottom: 1px solid var(--line); }
    #rows td { border: none; padding: 3px 0; white-space: normal; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
    #rows td::before { content: attr(data-label); display: block; font-size: 11px; color: var(--muted); }
    #rows td.name { grid-column: 1 / -1; font-size: 15px; }
    #rows td.name::before { display: none; }
    #rows td:empty { display: none; }
    #rows td.empty-state { grid-column: 1 / -1; }
    #historyRows td, #teamRows td, #activityRows td { white-space: normal; }
    /* Category picker fills the screen */
    .modal-backdrop { padding: 0; }
    .modal { width: 100%; height: 100%; border-radius: 0; }
    .modal-head { padding: 12px 14px 10px; }
    .searchrow { flex-wrap: wrap; }
    .modal-body { grid-template-columns: 1fr; grid-template-rows: 170px 1fr; }
    .side { border-right: none; border-bottom: 1px solid var(--line); }
    .main { padding: 14px; }
    .tiles { grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { font-size: 13px; padding: 10px; }
    .alllist { columns: 1; }
    .modal-foot { padding: 10px 12px; flex-wrap: wrap; }
    .modal-foot .chosen { flex-basis: 100%; }
  }
  @media (min-width: 761px) and (max-width: 1100px) {
    main { padding: 14px; }
    .modal { height: min(820px, 100%); }
    .modal-body { grid-template-columns: 240px 1fr; }
  }

  /* Polish */
  .me { margin-left: auto; padding-bottom: 0; }
  #me .pill { margin-left: 4px; }
  .avatar { width: 30px; height: 30px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 12px; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  tbody tr:hover td { background: var(--panel-2); }
  .results { box-shadow: var(--shadow); }
  .pill { font-weight: 600; }
  .spend { background: var(--chip); }
  .bell { background: var(--panel); }
  .bellpanel, .pop, .modal { background: var(--panel); }
  .builder > .lbl { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; padding-top: 9px; }
  #findBtn { padding: 10px 22px; font-size: 15px; border-radius: 11px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-color: transparent; }
  .empty-state { padding: 64px 20px; }
  .empty-state::before { content: ""; display: block; width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 16px;
    background: linear-gradient(135deg, var(--accent-soft), var(--chip)); box-shadow: inset 0 0 0 1px var(--line); }
  td.empty-state::before { display: none; }
  @media (max-width: 760px) {
    header { position: static; padding: 10px 12px; flex-wrap: wrap; }
    .tabs { order: 3; width: 100%; }
    .brand h1 small { display: none; }
    main { padding: 12px 10px 32px; }
    .pagehead h2 { font-size: 19px; }
  }
  /* Step-by-step find flow */
  .steps { list-style: none; display: flex; gap: 6px; margin: 0; padding: 0; flex-wrap: wrap; }
  .steps li { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 6px; border-radius: 99px; background: var(--panel); border: 1px solid var(--line); color: var(--muted); font-weight: 500; }
  .steps li span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--chip); font-size: 12px; font-weight: 700; }
  .steps li.on { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); font-weight: 600; }
  .steps li.on span { background: var(--accent); color: #fff; }
  .steps li.past span { background: var(--ok-soft); color: var(--ok); }
  .stephead { display: flex; align-items: center; gap: 10px; font-size: 16px; margin-bottom: 14px; }
  .stepnum { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-size: 13px; flex: none; }
  details.more { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 10px; }
  details.more > summary, details.breakdown > summary { cursor: pointer; color: var(--accent); font-weight: 600; list-style: none; }
  details.more > summary::-webkit-details-marker, details.breakdown > summary::-webkit-details-marker { display: none; }
  details.more > summary::before, details.breakdown > summary::before { content: "▸ "; } details[open] > summary::before { content: "▾ "; }
  details.more > summary .hint { font-weight: 400; margin-left: 6px; }
  .findrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .tile-stat { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--panel-2); }
  .tile-stat .k { font-size: 12px; color: var(--muted); font-weight: 600; }
  .tile-stat .v { font-size: 24px; font-weight: 700; letter-spacing: -.02em; margin-top: 2px; }
  .tile-stat .s { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .tile-stat.ok .v { color: var(--ok); } .tile-stat.accent { border-color: var(--accent-line); background: var(--accent-soft); } .tile-stat.accent .v { color: var(--accent); }
  .tile-stat.bad { border-color: var(--bad); background: var(--bad-soft); } .tile-stat.bad .v { color: var(--bad); }
  .sentence { margin: 14px 0 0; line-height: 1.6; }
  .callout { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
  .callout.bad { background: var(--bad-soft); color: var(--bad); } .callout.warn { background: var(--warn-soft); color: var(--warn); }
  .plan .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
  button.big { padding: 11px 20px; font-size: 15px; border-radius: 11px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-color: transparent; }
  details.breakdown { margin-top: 16px; }
  details.breakdown table { margin-top: 8px; }
  .prow { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) minmax(0, 1.6fr) 84px; gap: 8px 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
  .pname { font-weight: 600; }
  .pbar { height: 8px; border-radius: 99px; background: var(--chip); overflow: hidden; }
  .pbar i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .6s; }
  .pbar.run i { background: linear-gradient(90deg, var(--accent), #a78bfa, var(--accent)); background-size: 200% 100%; animation: flow 1.4s linear infinite; }
  .pbar.ok i { background: var(--ok); } .pbar.bad i { background: var(--bad); } .pbar.warn i { background: var(--warn); }
  @keyframes flow { to { background-position: -200% 0; } }
  .pstate { font-size: 13px; } .pstate.ok { color: var(--ok); } .pstate.bad { color: var(--bad); } .pstate.warn { color: var(--warn); } .pstate.run { color: var(--accent); }
  .perr { grid-column: 1 / -1; font-size: 12px; color: var(--bad); }
  tr.noterow td { border-top: none; padding-top: 0; white-space: normal; }
  td.acts { white-space: nowrap; }
  @media (max-width: 760px) {
    .steps li { padding: 4px 10px 4px 4px; font-size: 12px; }
    .prow { grid-template-columns: minmax(0, 1fr) auto; }
    .prow .pbar { grid-column: 1 / -1; order: 3; }
    .tile-stat .v { font-size: 20px; }
  }  button.recheck { opacity: .45; margin-left: 2px; } tr:hover button.recheck { opacity: 1; }
</style>
</head>
<body>
<header>
  <div class="brand"><div class="logo">LF</div><h1>Lead Finder<small>Admin</small></h1></div>
  <div class="tabs">
    <button class="tab active" data-tab="find" type="button">Find leads</button>
    <button class="tab" data-tab="database" type="button">Database</button>
    <button class="tab" data-tab="history" type="button">Pull history</button>
    <button class="tab" data-tab="team" type="button" id="teamTab" hidden>Team</button>
    <button class="tab" data-tab="activity" type="button" id="activityTab" hidden>Admin</button>
  </div>
  <div class="me">
    <span id="spend" class="spend" title="Spent this month (pulling, phone checks, counts) out of the monthly budget"></span>
    <div class="bellwrap"><button type="button" id="bell" class="bell" aria-label="Notifications">🔔<span id="bellCount" class="badge" hidden></span></button>
      <div id="bellPanel" class="bellpanel" hidden></div></div>
    <span id="me"></span>
  </div>
</header>

<main id="findView">
  <div class="pagehead"><h2 id="pageTitle">Find leads</h2><p id="pageSub">Search Google Business Profiles by place and type. Anything collected in the last 30 days is reused.</p></div>
  <ol class="steps" id="steps">
    <li data-step="1"><span>1</span>Choose</li><li data-step="2"><span>2</span>Review</li><li data-step="3"><span>3</span>Collect</li><li data-step="4"><span>4</span>Your list</li>
  </ol>
  <section class="card" id="builderCard">
    <h2 class="stephead"><span class="stepnum">1</span>What are you looking for?</h2>
    <div class="builder">
      <div class="lbl">Where</div>
      <div class="line">
        <div class="dd" id="dd-country"></div>
        <div class="dd" id="dd-region"></div>
        <div class="dd" id="dd-city"></div>
      </div>
      <div class="lbl">What</div>
      <div class="line">
        <button type="button" class="ghost" id="whatBtn">Types of business: choose…</button>
        <div class="picked" id="whatPicked"></div>
      </div>
      <div class="lbl">How many</div>
      <div class="line">
        <label class="muted">Up to <select id="maxResults">
          <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100" selected>100</option>
          <option value="250">250</option><option value="500">500</option><option value="1000">1,000</option><option value="2500">2,500</option>
          <option value="5000">5,000</option><option value="10000">10,000</option><option value="0">No limit (everything)</option>
        </select> businesses per search</label>
        
      </div>
    </div>
    <details class="more" id="moreOptions">
      <summary>More options <span class="hint" id="moreSummary">phone types, counting on Google</span></summary>
      <div class="builder" style="margin-top:12px">
      <div class="lbl">Phones</div>
      <div class="line">
        <div class="dd" id="dd-phonetypes"></div>
        <label title="Checks each verified, open business's phone after the pull. Uses phone-check credits, so it's only done when you ask.">
          <input type="checkbox" id="checkPhones"> Check phone types after pulling</label>
        <span class="hint">Google doesn't know mobile vs landline, so this is a second step after the pull, charged per number.</span>
      </div>
      <div class="lbl">Count first</div>
      <div class="line">
        <label><input type="checkbox" id="withCounts" checked> Check how many exist on Google</label>
        <select id="countWebsite"><option value="">with or without a website</option><option value="no">without a website</option><option value="yes">with a website</option></select>
        <label><input type="checkbox" id="countPhone"> with a phone number</label>
        <label><input type="checkbox" id="countVerified"> verified only</label>
        <span class="hint">about 1¢ per type + place, remembered for a week</span>
      </div>
      </div>
    </details>
    <div class="findrow">
      <button id="findBtn" type="button">Check what's available →</button>
      <span id="findMsg" class="hint">Nothing is collected or charged yet. You'll see the count and the cost first.</span>
    </div>
    <div class="hint" style="margin-top:10px">Tip: pick cities, or leave cities empty for whole states, or leave both empty for whole countries.</div>
  </section>

  <section class="card plan" id="plan" hidden></section>

  <section class="card" id="progress" hidden></section>

  <section class="card" id="filtersCard" hidden>
    <div class="filterbar" id="filterbar"></div>
  </section>

  <section class="card results" id="resultsCard">
    <div class="empty-state" id="emptyState">
      <strong>Nothing to show yet</strong>
      Choose where and what above, then click <b>Check what's available</b>.<br>
      <span class="hint">Everything you've already collected is in the <b>Database</b> tab.</span>
    </div>
    <div id="resultsBody" hidden>
      <div class="bar">
        <div class="scope"><strong id="count"></strong> <span id="dupInfo" class="muted"></span> <span id="scopeInfo"></span></div>
        <div>
          <button class="ghost small" id="checkPhonesBtn" type="button" title="Check mobile / landline for every unchecked phone matching these filters, verified or not">Check phones</button>
          <button class="small" id="downloadBtn" type="button" title="Every business matching the filters, in the GHL upload format">Download CSV</button>
          <button class="ghost small" id="prevBtn" type="button">‹ Prev</button>
          <span id="pageInfo" class="muted"></span>
          <button class="ghost small" id="nextBtn" type="button">Next ›</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th data-sort="name">Business</th><th data-sort="category">Category</th><th>Phone</th><th>Phone type</th><th>Website</th>
            <th data-sort="rating">Rating</th><th data-sort="reviews">Reviews</th><th data-sort="rank">Position</th><th>Verified</th>
            <th>Status</th><th>Location</th><th data-sort="city">City</th><th>State</th><th>Neighborhood</th><th data-sort="added" class="sorted">Added</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  </section>
</main>

<main id="historyView" hidden>
  <div class="pagehead"><h2>Pull history</h2><p>Every pull, what it found and what it cost. Cancel a pull that is still collecting, or resume one that failed.</p></div>
  <section class="card" id="historyAlerts" hidden></section>
  <section class="card results">
    <div class="history-filters">
      <label class="field">Business type<input type="text" id="hCategory" placeholder="e.g. plumber"></label>
      <label class="field">City<input type="text" id="hCity" placeholder="e.g. Orlando"></label>
      <label class="field">State<input type="text" id="hState" placeholder="FL" style="width:70px"></label>
      <label class="field">Status<select id="hStatus"><option value="">Any</option><option value="done">Ready</option>
        <option value="scraping">Collecting</option><option value="ingesting">Saving</option><option value="failed">Failed</option></select></label>
      <label class="field">From<input type="date" id="hFrom"></label>
      <label class="field">To<input type="date" id="hTo"></label>
      <button class="ghost" id="hViewSelected" type="button" disabled>Open the ticked lists together</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>When</th><th>Type of business</th><th>Where</th><th>Status</th>
          <th>Businesses</th><th>Cost</th><th></th></tr></thead>
        <tbody id="historyRows"></tbody>
      </table>
    </div>
  </section>
</main>

<main id="teamView" hidden>
  <div class="pagehead"><h2>Team</h2><p>Who can sign in, and what they can do.</p></div>
  <section class="card">
    <h2>Add a team member</h2>
    <div class="line">
      <label class="field">Email<input type="password" id="tEmail" placeholder="name@company.com" autocomplete="off" style="width:230px"></label>
      <label class="field">Name<input type="text" id="tName" placeholder="First Last" style="width:170px"></label>
      <label class="field">Temporary password<input type="text" id="tPassword" style="width:190px"></label>
      <label class="field">Role<select id="tRole"><option value="member">Member</option><option value="admin">Admin (can manage the team)</option></select></label>
      <button type="button" id="tAdd" style="align-self:end">Add</button>
      <span id="tMsg" class="hint" style="align-self:end"></span>
    </div>
    <div class="hint" style="margin-top:8px">Give them the email and temporary password yourself. They'll be asked to choose their own password the first time they sign in.</div>
  </section>
  <section class="card results">
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody id="teamRows"></tbody>
    </table></div>
  </section>
</main>

<main id="activityView" hidden>
  <div class="pagehead"><h2>Admin</h2><p>Spending limit, backups and everyone's activity. Only you can see this page.</p></div>
  <section class="card">
    <h2>Monthly budget</h2>
    <div class="line">
      <span id="budgetNow" class="muted"></span>
      <label class="muted">Budget per month $ <input type="number" id="budgetInput" min="0" step="5" style="width:110px"></label>
      <button type="button" id="budgetSave">Save</button>
      <span id="budgetMsg" class="hint"></span>
    </div>
    <div class="hint" style="margin-top:6px">Pulls and phone checks that would go over this are refused. It resets on the 1st of each month.</div>
  </section>
  <section class="card" id="backupCard">
    <h2>Backups</h2>
    <div class="line"><span id="backupNow" class="muted"></span>
      <button type="button" class="ghost" id="backupRun">Back up now</button><span id="backupMsg" class="hint"></span></div>
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Backup</th><th>Status</th><th>Rows</th><th>Size</th><th></th></tr></thead>
      <tbody id="backupRows"></tbody>
    </table></div>
    <div class="hint" style="margin-top:6px">A copy of every lead, pull and setting is saved each night at about 3 am (New York) and kept for 14 nights.
      To restore, download a backup and run the file with <code>npx wrangler d1 execute lead-scraper-db --remote --file &lt;file&gt;</code>.</div>
  </section>
  <section class="card results">
    <div class="history-filters">
      <label class="field">Person<select id="aUser"><option value="">Everyone</option></select></label>
      <label class="field">Action<select id="aAction"><option value="">Any</option></select></label>
      <label class="field">From<input type="date" id="aFrom"></label>
      <label class="field">To<input type="date" id="aTo"></label>
      <span class="hint" style="align-self:end">Your own actions (super admin) are not recorded.</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
      <tbody id="activityRows"></tbody>
    </table></div>
    <div class="bar"><span id="activityCount" class="muted"></span><span>
      <button class="ghost small" id="aPrev" type="button">‹ Prev</button> <button class="ghost small" id="aNext" type="button">Next ›</button></span></div>
  </section>
</main>

<div id="catPicker" class="modal-backdrop" hidden></div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v) => "$" + Number(v || 0).toFixed(2);
// Only normal web addresses become links. (No slashes in this pattern: this script sits inside a
// template string, where a backslash before a slash is silently dropped.)
const isWebLink = (u) => typeof u === "string" && /^https?:[/][/]/i.test(u);
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if ((res.status === 401 || res.status === 403) && body.signIn) { location.href = "/login"; throw new Error(body.error || "Please sign in again."); }
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + ")"); e.status = res.status; e.body = body; throw e; }
  return body;
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const PHONE_LABELS = { mobile: "Mobile", landline: "Landline", toll_free: "Toll-free", voip: "Internet (VoIP)", unknown: "Couldn't tell", unchecked: "Not checked yet", no_phone: "No phone" };
const STATUS_LABELS = { operational: "Open", temporarily_closed: "Temporarily closed", permanently_closed: "Permanently closed" };
const PULL_LABELS = { pending: "Starting", scraping: "Collecting", ingesting: "Saving", enriching: "Checking", done: "Ready", failed: "Failed" };
const REVIEW_LABELS = { none: "No reviews", "1-10": "1 – 10", "11-100": "11 – 100", "101-1000": "101 – 1,000", "1001-10000": "1,001 – 10,000", "10001+": "10,000+" };

// ---------------------------------------------------------------------------
// Dropdown chip: multi-select (default) or single-select, with search, select all / clear, groups and counts.
// ---------------------------------------------------------------------------
const dropdowns = [];
function dropdown(el, cfg) {
  const dd = { el, cfg, selected: cfg.selected || new Set() };
  el.classList.add("dd");
  el.innerHTML = '<button type="button" class="chip"></button><div class="pop"></div>';
  const chip = el.querySelector(".chip"), pop = el.querySelector(".pop");
  let filterText = "";
  dd.summary = () => {
    const opts = cfg.options();
    const picked = [...dd.selected];
    if (cfg.custom) return cfg.summary();
    if (!picked.length) return cfg.label + (cfg.allLabel ? ": " + cfg.allLabel : "");
    if (picked.length === 1) { const o = opts.find((x) => x.value === picked[0]); return cfg.label + ": " + (o ? o.label : picked[0]); }
    return cfg.label + ": " + picked.length + " selected";
  };
  dd.renderChip = () => {
    chip.textContent = dd.summary();
    chip.classList.toggle("on", cfg.custom ? cfg.isOn() : dd.selected.size > 0);
  };
  dd.renderPop = () => {
    if (cfg.custom) { pop.innerHTML = cfg.custom(); cfg.bind && cfg.bind(pop, dd); return; }
    const opts = cfg.options();
    const shown = filterText ? opts.filter((o) => (o.label + " " + (o.group || "")).toLowerCase().includes(filterText)) : opts;
    let html = "";
    if (cfg.search !== false && opts.length > 8) html += '<input type="text" class="search" placeholder="Search…" value="' + esc(filterText) + '">';
    if (!cfg.single) html += '<div class="bulk"><button type="button" class="link" data-act="all">Select all' + (filterText ? " shown" : "") + '</button><button type="button" class="link" data-act="clear">Clear</button></div>';
    html += '<div class="opts">';
    if (!shown.length) html += '<div class="empty">' + esc(cfg.emptyText || "Nothing here yet") + "</div>";
    let group = null;
    for (const o of shown) {
      if (o.group && o.group !== group) {
        group = o.group;
        html += '<div class="grp"><span>' + esc(group) + "</span>" + (cfg.single ? "" : '<button type="button" class="link" data-grp="' + esc(group) + '">Select all</button>') + "</div>";
      }
      const on = dd.selected.has(o.value);
      html += '<label class="opt"><input type="' + (cfg.single ? "radio" : "checkbox") + '" name="' + esc(cfg.label) + '" value="' + esc(o.value) + '"' + (on ? " checked" : "") + "> " +
        '<span>' + esc(o.label) + "</span>" + (o.n != null ? '<span class="n">' + Number(o.n).toLocaleString() + "</span>" : "") + "</label>";
    }
    html += "</div>";
    pop.innerHTML = html;
    const search = pop.querySelector(".search");
    if (search) { search.oninput = () => { filterText = search.value.trim().toLowerCase(); dd.renderPop(); const s = pop.querySelector(".search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }; }
  };
  const changed = () => { dd.renderChip(); dd.renderPop(); cfg.onChange && cfg.onChange(dd.selected); };
  pop.addEventListener("click", (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    const grp = e.target.dataset && e.target.dataset.grp;
    if (act === "all") { const opts = cfg.options(); (filterText ? opts.filter((o) => (o.label + " " + (o.group || "")).toLowerCase().includes(filterText)) : opts).forEach((o) => dd.selected.add(o.value)); changed(); }
    else if (act === "clear") { dd.selected.clear(); changed(); }
    else if (grp) { cfg.options().filter((o) => o.group === grp).forEach((o) => dd.selected.add(o.value)); changed(); }
  });
  pop.addEventListener("change", (e) => {
    if (cfg.custom) return;
    const input = e.target;
    if (input.classList.contains("search")) return;
    if (cfg.single) { dd.selected.clear(); if (input.value) dd.selected.add(input.value); el.classList.remove("open"); }
    else input.checked ? dd.selected.add(input.value) : dd.selected.delete(input.value);
    changed();
  });
  chip.onclick = () => {
    const open = !el.classList.contains("open");
    dropdowns.forEach((d) => d.el.classList.remove("open"));
    if (open) { filterText = ""; dd.renderPop(); el.classList.add("open"); const s = pop.querySelector(".search"); if (s) s.focus(); }
  };
  dd.set = (values) => { dd.selected = new Set(values); dd.renderChip(); };
  dd.refresh = () => { dd.renderChip(); if (el.classList.contains("open")) dd.renderPop(); };
  dd.renderChip();
  dropdowns.push(dd);
  return dd;
}
document.addEventListener("click", (e) => { if (!e.target.closest(".dd")) dropdowns.forEach((d) => d.el.classList.remove("open")); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") dropdowns.forEach((d) => d.el.classList.remove("open")); });

// ---------------------------------------------------------------------------
// Search builder: country -> state/province -> city, and what
// ---------------------------------------------------------------------------
let geo = { countries: [], regions: [], cities: [] }, tree = null;
const cityByKey = new Map(); // "US|FL|Orlando" -> { country, region, city }

const whereCountry = dropdown($("dd-country"), {
  label: "Countries", allLabel: "none chosen",
  // United States first, then alphabetical.
  options: () => geo.countries.map((c) => ({ value: c.code, label: c.name, group: c.code === "US" ? "Most used" : "All countries" }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Most used" ? -1 : 1)),
  onChange: () => loadRegions(),
});
const whereRegion = dropdown($("dd-region"), {
  label: "States / provinces", allLabel: "whole country", emptyText: "Choose a country first",
  options: () => geo.regions.map((r) => ({ value: r.country + "." + r.code, label: r.name, group: countryLabel(r.country) })),
  onChange: () => loadCities(),
});
const whereCity = dropdown($("dd-city"), {
  label: "Cities", allLabel: "whole state/province", emptyText: "Choose a country or state first",
  options: () => geo.cities.map((c) => {
    const key = c.country + "|" + (c.region || "") + "|" + c.name;
    // Listed biggest first (by population), so the major cities are at the top.
    return { value: key, label: c.name, group: (c.region_name || countryLabel(c.country)) + (whereCountry.selected.size > 1 ? " · " + c.country : "") };
  }),
});
// ---------------------------------------------------------------------------
// "What" picker: groups -> sectors -> popular tiles (+ "show all"), one search box, picks as tags.
// ---------------------------------------------------------------------------
const what = { selected: new Set(), refresh: () => renderWhat(), renderChip: () => renderWhat() };
const picker = { sector: "Home Services", search: "", showAll: false };
const sectorOf = (name) => tree && tree.industries.find((i) => i.industry === name);
const inSector = (name) => { const s = sectorOf(name); return s ? s.categories : []; };

function renderWhat() {
  const n = what.selected.size;
  $("whatBtn").textContent = n ? "Types of business: " + (n === 1 ? [...what.selected][0] : n + " selected") + " ▾" : "Types of business: choose… ▾";
  $("whatBtn").classList.toggle("on", n > 0);
  const shown = [...what.selected].slice(0, 8);
  $("whatPicked").innerHTML = shown.map((c) => '<span class="tag">' + esc(c) + ' <button type="button" data-unpick="' + esc(c) + '" aria-label="Remove">×</button></span>').join("") +
    (n > 8 ? '<span class="muted">+' + (n - 8) + " more</span>" : "") + (n ? ' <button type="button" class="link small" data-act="clear-what">clear</button>' : "");
  if (!$("catPicker").hidden) renderPicker();
}

// Matches the start of any word, so "dent" finds Dentist but not Residents.
function wordMatch(name, q) {
  const words = (s) => " " + s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return words(name).includes(words(q));
}
function groupIcon(sector) { const g = tree && tree.groups.find((x) => x.sectors.includes(sector)); return g ? g.icon : ""; }
function tileHtml(c, sel) {
  return '<button type="button" class="tile' + (sel.has(c.name) ? " on" : "") + '" data-cat="' + esc(c.name) + '"><span class="tick">✓</span><span>' +
    esc(c.name) + "</span>" + (c.top100 ? '<span class="star" title="Top 100">★</span>' : "") + "</button>";
}
function renderPicker() {
  const box = $("catPicker");
  if (!tree) { box.innerHTML = '<div class="modal"><div class="empty-state">Loading categories…</div></div>'; return; }
  const sel = what.selected;
  const total = tree.industries.reduce((s, i) => s + i.categories.length, 0);

  const side = tree.groups.map((g) =>
    '<div class="gtitle"><span class="ico">' + g.icon + "</span>" + esc(g.group) + "</div>" + g.sectors.map((s) => {
      const cats = inSector(s), picked = cats.filter((c) => sel.has(c.name)).length;
      return '<div class="sec' + (picker.sector === s && !picker.search ? " active" : "") + '" data-sector="' + esc(s) + '"><span>' + esc(s) + '</span>' +
        (picked ? '<span class="cnt some">' + picked + "</span>" : '<span class="cnt">' + cats.length + "</span>") + "</div>";
    }).join("")).join("");

  let main = "";
  const q = picker.search.trim().toLowerCase();
  if (q) {
    const hits = tree.industries.flatMap((i) => i.categories.filter((c) => wordMatch(c.name, q)).map((c) => ({ ...c, sector: i.industry })));
    main = '<div class="head"><div><h3>' + hits.length.toLocaleString() + " result" + (hits.length === 1 ? "" : "s") + '</h3><span class="hint">for "' + esc(picker.search.trim()) + '" across all sectors</span></div>' +
      (hits.length ? '<button type="button" class="pill-btn" data-act="add-hits">Select all ' + Math.min(hits.length, 500) + "</button>" : "") + "</div>";
    if (!hits.length) main += '<p class="muted" style="margin-top:18px">Nothing matches. Try a shorter word, e.g. "roof", "dent" or "pizza".</p>';
    else {
      // Group the hits by sector so the same word in different trades is easy to tell apart.
      const bySector = new Map();
      hits.slice(0, 400).forEach((c) => { if (!bySector.has(c.sector)) bySector.set(c.sector, []); bySector.get(c.sector).push(c); });
      for (const [sector, list] of bySector) main += '<div class="sub">' + groupIcon(sector) + " " + esc(sector) + '</div><div class="tiles">' + list.map((c) => tileHtml(c, sel)).join("") + "</div>";
    }
  } else {
    const cats = inSector(picker.sector);
    const popular = cats.slice(0, tree.popularPerSector);
    const picked = cats.filter((c) => sel.has(c.name)).length;
    main = '<div class="head"><div><h3>' + groupIcon(picker.sector) + " " + esc(picker.sector) + '</h3><span class="hint">' + cats.length + " types" + (picked ? " · " + picked + " picked" : "") + "</span></div><div>" +
      (picked ? '<button type="button" class="link small" data-act="sector-none">Clear</button> &nbsp;' : "") +
      '<button type="button" class="pill-btn" data-act="sector-all">' + (picked === cats.length ? "✓ All selected" : "Select all " + cats.length) + "</button></div></div>" +
      '<div class="sub">Most popular</div><div class="tiles">' + popular.map((c) => tileHtml(c, sel)).join("") + "</div>";
    if (cats.length > popular.length) {
      if (!picker.showAll) main += '<button type="button" class="showall" data-act="show-all">Show all ' + cats.length + " types in " + esc(picker.sector) + " ›</button>";
      else {
        main += '<div class="sub">All ' + cats.length + ' types, A–Z</div><div class="alllist">' + [...cats].sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
          '<label><input type="checkbox" data-cat="' + esc(c.name) + '"' + (sel.has(c.name) ? " checked" : "") + "> <span>" + esc(c.name) + (c.top100 ? ' <span style="color:#f79009">★</span>' : "") + "</span></label>").join("") + "</div>";
      }
    }
  }

  const chosen = [...sel];
  const foot = chosen.length
    ? chosen.slice(0, 30).map((c) => '<span class="tag">' + esc(c) + ' <button type="button" data-unpick="' + esc(c) + '" aria-label="Remove">×</button></span>').join("") +
      (chosen.length > 30 ? '<span class="muted">+' + (chosen.length - 30) + " more</span>" : "")
    : '<span class="hint">Nothing picked yet. Click a tile to pick it. ★ marks the Top 100 types.</span>';

  const keepScroll = box.querySelector(".main")?.scrollTop || 0, keepSide = box.querySelector(".side")?.scrollTop || 0;
  box.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Choose types of business">' +
    '<div class="modal-head"><div class="title"><h2>Choose types of business</h2><button type="button" class="x" data-act="close-picker" aria-label="Close">×</button></div>' +
    '<div class="searchrow"><div class="searchbox"><input type="text" id="pickerSearch" placeholder="Search ' + total.toLocaleString() + ' types, e.g. roofing, dentist, pizza" value="' + esc(picker.search) + '"></div>' +
    '<button type="button" class="pill-btn" data-act="top100" title="The 100 types most worth targeting: from the sectors you picked from, or all">★ Add Top 100</button></div></div>' +
    '<div class="modal-body"><div class="side">' + side + '</div><div class="main">' + main + "</div></div>" +
    '<div class="modal-foot"><div class="chosen">' + foot + "</div>" +
    (chosen.length ? '<button type="button" class="link small" data-act="clear-what">Clear all</button>' : "") +
    '<button type="button" class="done" data-act="close-picker">Done' + (chosen.length ? " · " + chosen.length + " picked" : "") + "</button></div></div>";
  const m = box.querySelector(".main"); if (m) m.scrollTop = keepScroll;
  const s = box.querySelector(".side"); if (s) s.scrollTop = keepSide;
  const input = $("pickerSearch");
  input.oninput = () => { picker.search = input.value; renderPicker(); const i = $("pickerSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
}
function openPicker() { $("catPicker").hidden = false; document.body.style.overflow = "hidden"; renderPicker(); $("pickerSearch") && $("pickerSearch").focus(); }
function closePicker() { $("catPicker").hidden = true; document.body.style.overflow = ""; }
$("whatBtn").onclick = openPicker;
// Click outside the window or press Escape to close.
$("catPicker").addEventListener("mousedown", (e) => { if (e.target === $("catPicker")) closePicker(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("catPicker").hidden) closePicker(); });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cat],[data-sector],[data-act],[data-unpick]");
  if (!t || !(t.closest("#catPicker") || t.closest("#whatPicked"))) return;
  const sel = what.selected;
  if (t.dataset.unpick) sel.delete(t.dataset.unpick);
  else if (t.dataset.sector) { picker.sector = t.dataset.sector; picker.search = ""; picker.showAll = false; }
  else if (t.dataset.cat && t.tagName === "BUTTON") sel.has(t.dataset.cat) ? sel.delete(t.dataset.cat) : sel.add(t.dataset.cat);
  else if (t.dataset.cat) t.checked ? sel.add(t.dataset.cat) : sel.delete(t.dataset.cat);
  else switch (t.dataset.act) {
    case "sector-all": inSector(picker.sector).forEach((c) => sel.add(c.name)); break;
    case "sector-none": inSector(picker.sector).forEach((c) => sel.delete(c.name)); break;
    case "show-all": picker.showAll = true; break;
    case "add-hits": { const q = picker.search.trim().toLowerCase(); tree.industries.flatMap((i) => i.categories).filter((c) => wordMatch(c.name, q)).slice(0, 500).forEach((c) => sel.add(c.name)); break; }
    case "top100": {
      const sectors = new Set(tree.industries.filter((i) => i.categories.some((c) => sel.has(c.name))).map((i) => i.industry));
      tree.industries.filter((i) => !sectors.size || sectors.has(i.industry)).forEach((i) => i.categories.filter((c) => c.top100).forEach((c) => sel.add(c.name)));
      break;
    }
    case "clear-what": sel.clear(); break;
    case "close-picker": closePicker(); break;
    default: return;
  }
  renderWhat();
});
// Phone types wanted: picking any switches phone checks on and filters the results to those types.
const phoneTypesWanted = dropdown($("dd-phonetypes"), {
  label: "Phone types wanted", allLabel: "any", search: false,
  options: () => [{ value: "mobile", label: "Mobile" }, { value: "landline", label: "Landline" }, { value: "voip", label: "Internet (VoIP)" }, { value: "toll_free", label: "Toll-free" }],
  onChange: (sel) => { if (sel.size) $("checkPhones").checked = true; $("checkPhones").disabled = sel.size > 0; },
});
function countryLabel(code) { const c = geo.countries.find((x) => x.code === code); return c ? c.name : code; }

async function loadRegions() {
  const countries = [...whereCountry.selected];
  geo.regions = countries.length ? await api("/api/geo/regions?" + countries.map((c) => "country=" + encodeURIComponent(c)).join("&")) : [];
  // Drop picked states that no longer belong to a picked country.
  [...whereRegion.selected].forEach((k) => { if (!geo.regions.some((r) => r.country + "." + r.code === k)) whereRegion.selected.delete(k); });
  whereRegion.refresh();
  await loadCities();
}
async function loadCities() {
  const regions = [...whereRegion.selected], countries = [...whereCountry.selected];
  if (!countries.length) geo.cities = [];
  else {
    const p = new URLSearchParams();
    if (regions.length) regions.forEach((r) => p.append("region", r)); else countries.forEach((c) => p.append("country", c));
    p.set("limit", regions.length ? "2000" : "500");
    geo.cities = await api("/api/geo/cities?" + p);
  }
  cityByKey.clear();
  geo.cities.forEach((c) => cityByKey.set(c.country + "|" + (c.region || "") + "|" + c.name, { country: c.country, region: c.region, city: c.name }));
  [...whereCity.selected].forEach((k) => { if (!cityByKey.has(k)) whereCity.selected.delete(k); });
  whereCity.refresh();
}

/** Cities if any are picked; else states/provinces; else whole countries. */
function locationsFromBuilder() {
  if (whereCity.selected.size) return [...whereCity.selected].map((k) => cityByKey.get(k)).filter(Boolean);
  if (whereRegion.selected.size) return [...whereRegion.selected].map((k) => { const [country, region] = k.split("."); return { country, region }; });
  return [...whereCountry.selected].map((country) => ({ country }));
}

// ---------------------------------------------------------------------------
// Find leads: plan (+ counts) -> (maybe) pull -> show results
// ---------------------------------------------------------------------------
let lastRequest = null;
const BIG = 100000;
$("findBtn").onclick = async () => {
  const req = {
    categories: [...what.selected], locations: locationsFromBuilder(), maxResults: Number($("maxResults").value),
    withCounts: $("withCounts").checked, countWebsite: $("countWebsite").value || null, countVerifiedOnly: $("countVerified").checked,
    countWithPhone: $("countPhone").checked,
    checkPhones: $("checkPhones").checked || phoneTypesWanted.selected.size > 0,
  };
  lastPhoneTypes = [...phoneTypesWanted.selected];
  if (!req.categories.length) { $("findMsg").className = "hint err"; $("findMsg").textContent = "Pick at least one type of business."; return; }
  if (!req.locations.length) { $("findMsg").className = "hint err"; $("findMsg").textContent = "Pick at least one country."; return; }
  $("findMsg").className = "hint"; $("findMsg").textContent = req.withCounts ? "Counting and checking what we already have…" : "Checking what we already have…";
  $("findBtn").disabled = true;
  try {
    const plan = await postJson("/api/find", { ...req, mode: "plan" });
    lastRequest = req;
    $("findMsg").textContent = "";
    showPlan(plan);
    // Nothing to pull and no phone checks to pay for: show the results straight away.
    if (!plan.needPull && !req.checkPhones) { setStep(4); showResults(plan); }
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
  finally { $("findBtn").disabled = false; }
};

function where(c) { return c.place ? c.place.label : c.city ? c.city + ", " + c.state : "all of " + c.state; }
function planLabel(plan) {
  const cats = [...new Set(plan.combinations.map((c) => c.category))], locs = [...new Set(plan.combinations.map(where))];
  return (cats.length > 2 ? cats.length + " types" : cats.join(", ")) + " in " + (locs.length > 2 ? locs.length + " places" : locs.join(", "));
}
const num = (n) => Number(n).toLocaleString();
// Step 2: a plain-language review of what we have, what's new and what it costs.
let planIds = [], startedIds = [];
function names(list, max) {
  const labels = list.map((c) => c.category + " in " + where(c));
  return labels.length > max ? labels.slice(0, max).join(", ") + " and " + (labels.length - max) + " more" : labels.join(", ");
}
function showPlan(plan) {
  const done = plan.mode !== "plan";
  const req = lastRequest || {};
  const phones = plan.checkPhones;
  const combos = plan.combinations;
  planIds = plan.searchIds || [];
  const started = combos.filter((c) => c.started);
  if (started.length) startedIds = started.map((c) => c.started.id);
  if (done) {
    // Collecting has started: the progress card takes over; keep a one-line summary here.
    const failed = started.filter((c) => c.error);
    $("plan").hidden = false;
    $("plan").innerHTML = '<h2 class="stephead"><span class="stepnum">2</span>Review</h2><div class="muted">' +
      (started.length ? "Started collecting " + started.length + " search" + (started.length > 1 ? "es" : "") + ". Follow it below." : "Using what's already in your database.") +
      (failed.length ? ' <span class="err">' + failed.length + " couldn't start: " + esc(failed[0].error) + "</span>" : "") +
      ' <button type="button" class="link" id="newSearch">Start a new search</button></div>';
    $("newSearch").onclick = () => { $("plan").hidden = true; $("progress").hidden = true; lastRequest = null; startedIds = []; setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); };
    return;
  }
  const refine = [req.countWebsite === "no" ? "without a website" : req.countWebsite === "yes" ? "with a website" : "",
    req.countWithPhone ? "with a phone" : "", req.countVerifiedOnly ? "verified" : ""].filter(Boolean).join(", ");
  const have = combos.filter((c) => c.existing), missing = combos.filter((c) => !c.existing);
  const empty = have.filter((c) => c.existing.status === "done" && !c.existing.results_count);
  const haveBiz = have.reduce((s, c) => s + (c.existing.leads_in_database || 0), 0);
  const newBiz = missing.reduce((s, c) => s + (c.expected != null ? c.expected : c.count && c.count.total != null ? c.count.total : 0), 0);
  const newKnown = missing.every((c) => c.expected != null || (c.count && c.count.total != null));
  const b = plan.budget;
  const cost = plan.estimatedCostMissing;
  const overBudget = b && cost != null && cost > b.left + 1e-9;
  const tile = (label, value, sub, cls) => '<div class="tile-stat ' + (cls || "") + '"><div class="k">' + label + '</div><div class="v">' + value + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>";

  let sentence = "";
  if (have.length) sentence += "<b>Already in your database:</b> " + esc(names(have, 3)) + ". ";
  if (missing.length) sentence += "<b>New to collect:</b> " + esc(names(missing, 3)) + ".";
  if (empty.length) sentence += ' <span class="muted">(' + esc(names(empty, 2)) + ": Google has none of these there.)</span>";

  let actions = "";
  if (missing.length) actions += '<button type="button" id="pullMissing" class="big"' + (cost == null && plan.maxResults === 0 ? " disabled" : "") + ">Collect " +
    (newKnown && newBiz ? "~" + num(newBiz) + " new businesses" : missing.length + " new search" + (missing.length > 1 ? "es" : "")) +
    (cost != null ? " · about " + money(cost) : "") + "</button>";
  if (have.length) actions += '<button type="button" class="ghost" id="useHave">' + (phones ? "Use what I have + check phones · up to " + money(plan.estimatedCostExisting) : missing.length ? "Just show what I have (free)" : "Show my list (free)") + "</button>";
  if (have.length) actions += '<button type="button" class="link" id="refreshAll" title="Collects everything again for fresh data, including what you already have">Re-collect everything for fresh data' + (plan.estimatedCostAll != null ? " · about " + money(plan.estimatedCostAll) : "") + "</button>";

  let warn = "";
  if (overBudget && missing.length) warn += '<div class="callout bad">This would go over the monthly budget (' + money(b.left) + ' left), so it will be refused. Pick fewer places, a lower "Up to", or ask the super admin to raise the budget.</div>';
  if (plan.totalCount != null && plan.totalCount > BIG) warn += '<div class="callout warn">That’s ' + num(plan.totalCount) + " businesses on Google. Consider fewer places or types, or cities instead of whole countries.</div>";
  if (cost == null && plan.maxResults === 0 && missing.length) warn += '<div class="callout warn">With "No limit", turn on "Check how many exist on Google" under More options so the cost can be shown first.</div>';

  const rows = combos.map((c) => {
    const onGoogle = !c.count ? "" : c.count.total == null ? '<span class="muted">unknown</span>' : num(c.count.total);
    const inDb = c.existing ? num(c.existing.leads_in_database) + ' <span class="muted">(' + esc((c.existing.created_at || "").slice(0, 10)) + ")</span>" : '<span class="muted">none yet</span>';
    const toPay = c.existing ? '<span class="muted">free</span>' : c.pullCost == null ? '<span class="muted">unknown</span>' : money(c.pullCost) + (phones && c.phoneCost != null ? ' <span class="muted">+ ' + money(c.phoneCost) + " phones</span>" : "");
    return "<tr><td>" + esc(c.category) + "</td><td>" + esc(where(c)) + "</td><td>" + onGoogle + "</td><td>" + inDb + "</td><td>" + toPay + "</td></tr>";
  }).join("");

  $("plan").hidden = false;
  $("plan").innerHTML = '<h2 class="stephead"><span class="stepnum">2</span>Review before collecting</h2>' +
    '<div class="stats">' +
      tile("On Google", plan.totalCount != null ? num(plan.totalCount) : "—", plan.totalCount != null ? (refine ? esc(refine) : "for this search") : "not counted") +
      tile("Already in your database", num(haveBiz), have.length + " of " + combos.length + " search" + (combos.length > 1 ? "es" : ""), "ok") +
      tile("New to collect", missing.length ? (newKnown ? "~" + num(newBiz) : missing.length + " search" + (missing.length > 1 ? "es" : "")) : "0", missing.length ? "not in your database yet" : "nothing new", missing.length ? "accent" : "") +
      tile("Estimated cost", missing.length ? (cost != null ? money(cost) : "unknown") : "Free",
        missing.length && phones && plan.estimatedPullMissing != null ? money(plan.estimatedPullMissing) + " collecting + up to " + money(plan.estimatedPhoneCost) + " phone checks" : missing.length ? "about $5 per 1,000 businesses" : "", overBudget ? "bad" : "") +
      (b ? tile("Budget left this month", money(b.left), "of " + money(b.budget), b.left <= 0 ? "bad" : "") : "") +
    "</div>" +
    (sentence ? '<p class="sentence">' + sentence + "</p>" : "") + warn +
    '<div class="actions">' + actions + "</div>" +
    '<details class="breakdown"><summary>See the breakdown by search</summary><div class="table-wrap"><table><thead><tr><th>Type of business</th><th>Where</th><th>On Google</th><th>In your database</th><th>Cost to collect</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    '<div class="hint" style="margin-top:6px">' + (plan.maxResults ? "Up to " + num(plan.maxResults) + " businesses per search." : "No limit: every business Google has.") +
    " Collecting is charged for every business a search returns" + (refine ? " (the " + esc(refine) + " part only narrows the count, not what's collected)" : "") + "." +
    (phones ? " Phone checks only run on verified, open businesses with a phone." : "") + (plan.countCost ? " Counting cost " + money(plan.countCost) + "." : "") + "</div></details>";
  if ($("pullMissing")) $("pullMissing").onclick = () => confirmBig(cost) && runPull("pull_missing");
  if ($("useHave")) $("useHave").onclick = () => (phones ? runPull("use_existing") : (setStep(4), showResults(plan)));
  if ($("refreshAll")) $("refreshAll").onclick = () => confirm("Collect everything again, including what you already have? About " + money(plan.estimatedCostAll) + ".") && runPull("refresh_all");
  setStep(2);
  $("plan").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Step 3: one row per search with a progress bar; cancel / resume in place.
const STAGE = {
  pending: ["Starting…", 8], scraping: ["Collecting from Google…", 40], ingesting: ["Saving to your database…", 75],
  enriching: ["Checking…", 90], done: ["Ready", 100], failed: ["Failed", 100],
};
function renderProgress() {
  if (!startedIds.length) { $("progress").hidden = true; return; }
  const rows = startedIds.map((id) => pulls.find((p) => p.id === id)).filter(Boolean);
  if (!rows.length) return;
  const running = rows.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
  const saved = rows.reduce((n, s) => n + (s.leads_in_database || 0), 0);
  const failed = rows.filter((s) => s.status === "failed");
  const head = running.length
    ? "Collecting… " + (rows.length - running.length) + " of " + rows.length + " searches done · " + num(saved) + " businesses saved so far"
    : failed.length ? "Finished with problems · " + num(saved) + " businesses saved" : "All done · " + num(saved) + " businesses ready";
  $("progress").hidden = false;
  $("progress").innerHTML = '<h2 class="stephead"><span class="stepnum">3</span>' + esc(head) + "</h2>" +
    (running.length ? '<div class="hint" style="margin:-4px 0 10px">You can leave this page or close it. Collecting carries on, and the results appear in the list below as they arrive.</div>' : "") +
    rows.map((s) => {
      const [label, pct] = STAGE[s.status] || [s.status, 50];
      const stopped = !!s.cancelled_at && s.status === "done";
      const text = s.status === "done" ? (stopped ? "Stopped · kept " + num(s.leads_in_database) : !s.results_count ? "None on Google here" : "Ready · " + num(s.leads_in_database) + " businesses")
        : s.status === "ingesting" ? label + " " + num(s.results_count || 0) + " so far" : label;
      const cls = s.status === "failed" ? "bad" : s.status === "done" ? (stopped ? "warn" : "ok") : "run";
      const btn = (s.status === "pending" || s.status === "scraping") && !s.cancelled_at ? '<button type="button" class="ghost small danger" data-cancel="' + esc(s.id) + '">Cancel</button>'
        : s.status === "failed" && s.apify_run_id ? '<button type="button" class="ghost small" data-resume="' + esc(s.id) + '">Resume</button>' : "";
      return '<div class="prow"><div class="pname">' + esc(s.category) + ' <span class="muted">· ' + (s.city ? esc(s.city) + ", " : "all of ") + esc(s.region_name || s.state || s.country || "") + "</span></div>" +
        '<div class="pbar ' + cls + '"><i style="width:' + pct + '%"></i></div><div class="pstate ' + cls + '">' + esc(text) + "</div><div>" + btn + "</div>" +
        (s.status === "failed" && s.error ? '<div class="perr">' + esc(s.error) + "</div>" : "") + "</div>";
    }).join("");
  if (!running.length && !$("resultsBody").hidden) setStep(4); else if (running.length) setStep(3);
}
function setStep(n) {
  document.querySelectorAll("#steps li").forEach((li) => { const k = Number(li.dataset.step); li.classList.toggle("on", k === n); li.classList.toggle("past", k < n); });
}
async function pullAction(e, after) {
  const c = e.target.closest("[data-cancel]");
  if (c) {
    if (!confirm("Stop this search? Businesses it has already collected are kept (they are already paid for).")) return true;
    c.disabled = true;
    try { await api("/api/searches/" + c.dataset.cancel + "/cancel", { method: "POST" }); startPolling(); } catch (err) { alert(err.message); }
    await loadPulls(); after(); return true;
  }
  const r = e.target.closest("[data-resume]");
  if (r) {
    r.disabled = true;
    try { await api("/api/searches/" + r.dataset.resume + "/resume", { method: "POST" }); startPolling(); } catch (err) { alert(err.message); }
    await loadPulls(); after(); return true;
  }
  return false;
}
$("progress").onclick = (e) => pullAction(e, renderProgress);
let lastPhoneTypes = [];
/** Show a plan's results; if particular phone types were asked for, filter to them. */
function showResults(plan) {
  useScope(plan.searchIds, planLabel(plan));
  if (lastPhoneTypes.length) { f.phoneType.set(lastPhoneTypes); f.phone.set(["yes"]); reload(); }
}
function confirmBig(cost) {
  return cost == null || cost < 25 || confirm("This pull is estimated at " + money(cost) + ". Go ahead?");
}
async function runPull(mode) {
  document.querySelectorAll("#plan button").forEach((b) => b.disabled = true);
  try {
    const result = await postJson("/api/find", { ...lastRequest, withCounts: false, mode });
    showPlan(result);
    await loadPulls();
    renderProgress();
    showResults(result);
    startPolling(); loadSpend(); loadNotifications();
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
}

// ---------------------------------------------------------------------------
// Results scope + filters
// ---------------------------------------------------------------------------
const view = { scope: null, scopeLabel: "", page: 1, sort: "added", dir: "desc", text: {} };
let facets = null, pulls = [];
const f = {}; // filter dropdowns by key

function countOf(rows, value) { const r = (rows || []).find((x) => x.value === value); return r ? r.n : 0; }
function fromFacet(rows, labels) { return (rows || []).filter((r) => r.value != null).map((r) => ({ value: r.value, label: (labels && labels[r.value]) || r.value, n: r.n })); }

function buildFilters() {
  const bar = $("filterbar");
  const groups = [
    ["Location", ["state", "city", "neighborhood", "postal", "distance"]],
    ["Category", ["industry", "category", "exclude", "top100"]],
    ["Business", ["status", "verified", "location", "price", "photos", "attribute"]],
    ["Reputation", ["rating", "reviews", "position"]],
    ["Contact", ["phone", "phoneType", "website", "dedupe"]],
    ["More", ["dates", "leadStatus", "source", "name", "clear"]],
  ];
  bar.innerHTML = groups.map(([g, keys]) => '<div class="fgroup"><span class="glabel">' + g + "</span>" + keys.map((k) => '<div id="f-' + k + '"></div>').join("") + "</div>").join("");
  const multi = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "All", options, onChange: reload, ...(extra || {}) }); };
  const single = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "Any", single: true, search: false, options, onChange: reload, ...(extra || {}) }); };

  multi("state", "State", () => fromFacet(facets && facets.states));
  multi("city", "City", () => ((facets && facets.cities) || []).filter((c) => !f.state.selected.size || f.state.selected.has(c.state)).map((c) => ({ value: c.city, label: c.city + (c.state ? ", " + c.state : ""), n: c.n })));
  multi("neighborhood", "Neighborhood", () => fromFacet(facets && facets.neighborhoods));
  multi("postal", "ZIP code", () => fromFacet(facets && facets.postalCodes));
  f.distance = dropdown($("f-distance"), {
    label: "Distance", custom: () => {
      const placesOpts = ((facets && facets.cities) || []).map((c) => '<option value="' + esc(c.city + "|" + (c.state || "")) + '"' + (view.text.near === c.city + "|" + (c.state || "") ? " selected" : "") + ">" + esc(c.city + (c.state ? ", " + c.state : "")) + "</option>").join("") +
        ((facets && facets.postalCodes) || []).map((p) => '<option value="zip:' + esc(p.value) + '"' + (view.text.near === "zip:" + p.value ? " selected" : "") + ">ZIP " + esc(p.value) + "</option>").join("");
      return '<div class="dates"><span>Within</span><select id="radiusSel"><option value="">any distance</option>' + [1, 5, 10, 25, 50].map((m) => '<option value="' + m + '"' + (String(view.text.radius) === String(m) ? " selected" : "") + ">" + m + " mile" + (m > 1 ? "s" : "") + "</option>").join("") +
        '</select><span>of</span><select id="nearSel"><option value="">choose a place</option>' + placesOpts + '</select></div><div class="hint" style="margin-top:6px">Measured from the middle of the businesses we have in that place.</div>';
    },
    bind: (pop, dd) => { pop.querySelectorAll("select").forEach((s) => s.onchange = () => { view.text.radius = pop.querySelector("#radiusSel").value; view.text.near = pop.querySelector("#nearSel").value; dd.renderChip(); reload(); }); },
    summary: () => view.text.radius && view.text.near ? "Within " + view.text.radius + " mi of " + view.text.near.replace("zip:", "ZIP ").replace("|", ", ") : "Distance: Any",
    isOn: () => !!(view.text.radius && view.text.near),
    options: () => [],
  });

  multi("industry", "Industry", () => fromFacet(facets && facets.industries));
  multi("category", "Category", () => {
    const inds = f.industry.selected;
    return ((facets && facets.categories) || []).filter((c) => !inds.size || inds.has(industryOfCategory(c.value))).map((c) => ({ value: c.value, label: c.value, n: c.n, group: industryOfCategory(c.value) }))
      .sort((a, b) => a.group.localeCompare(b.group) || b.n - a.n);
  });
  multi("exclude", "Exclude", () => fromFacet(facets && facets.categories), { allLabel: "none" });
  single("top100", "Top 100", () => [{ value: "", label: "All categories" }, { value: "1", label: "Top 100 categories only" }], { allLabel: "off" });

  multi("status", "Status", () => Object.keys(STATUS_LABELS).map((v) => ({ value: v, label: STATUS_LABELS[v], n: countOf(facets && facets.statuses, v) })), { selected: new Set(["operational"]) });
  multi("verified", "Verification", () => [{ value: "verified", label: "Verified", n: countOf(facets && facets.verified, "verified") }, { value: "unverified", label: "Not verified", n: countOf(facets && facets.verified, "unverified") }], { selected: new Set(["verified"]) });
  multi("location", "Location type", () => [{ value: "storefront", label: "Physical location (street address)", n: countOf(facets && facets.location, "storefront") }, { value: "service_area", label: "Service area only", n: countOf(facets && facets.location, "service_area") }]);
  multi("price", "Price", () => ["$", "$$", "$$$", "$$$$"].map((v) => ({ value: v, label: v, n: countOf(facets && facets.prices, v) })));
  single("photos", "Photos", () => [{ value: "", label: "Any" }, ...[1, 10, 25, 50, 100].map((n) => ({ value: String(n), label: n + "+ photos" }))]);
  multi("attribute", "Profile features", () => fromFacet(facets && facets.attributes), { allLabel: "Any" });

  single("rating", "Rating", () => [{ value: "", label: "Any rating" },
    ...["4.5", "4.0", "3.5", "3.0", "2.5", "2.0"].map((v) => ({ value: "min:" + v, label: v + " and up" })),
    ...["4.0", "3.5", "3.0", "2.5", "2.0", "1.5"].map((v) => ({ value: "max:" + v, label: v + " and below" }))]);
  multi("reviews", "Reviews", () => Object.keys(REVIEW_LABELS).map((k) => ({ value: k, label: REVIEW_LABELS[k], n: countOf(facets && facets.reviewBuckets, k) })));
  single("position", "Position", () => [{ value: "", label: "Any position" },
    ...[3, 10, 20, 50].map((n) => ({ value: "rank:" + n, label: n === 3 ? "Top 3 (map pack)" : "Top " + n })),
    ...[1, 5, 10, 25].map((n) => ({ value: "pct:" + n, label: "Top " + n + "% of results" }))]);

  single("phone", "Phone", () => [{ value: "", label: "All" }, { value: "yes", label: "With a phone number" }, { value: "no", label: "Without a phone number" }]);
  multi("phoneType", "Phone type", () => ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"].map((v) => ({ value: v, label: PHONE_LABELS[v], n: countOf(facets && facets.phoneTypes, v) })));
  single("website", "Website", () => [{ value: "", label: "All" }, { value: "yes", label: "With a website" }, { value: "no", label: "Without a website" }]);
  multi("dedupe", "Remove duplicates", () => [{ value: "website", label: "One business per website" }, { value: "phone", label: "One business per phone number" }, { value: "listing", label: "One per Google listing" }], { allLabel: "off", search: false });

  f.dates = dropdown($("f-dates"), {
    label: "Dates", options: () => [],
    custom: () => '<div class="dates"><span>Added from</span><input type="date" id="dAddedFrom" value="' + esc(view.text.addedFrom || "") + '"><span>Added to</span><input type="date" id="dAddedTo" value="' + esc(view.text.addedTo || "") + '">' +
      '<span>Updated from</span><input type="date" id="dUpdatedFrom" value="' + esc(view.text.updatedFrom || "") + '"><span>Updated to</span><input type="date" id="dUpdatedTo" value="' + esc(view.text.updatedTo || "") + '"></div>',
    bind: (pop, dd) => { pop.querySelectorAll("input").forEach((i) => i.onchange = () => {
      view.text.addedFrom = pop.querySelector("#dAddedFrom").value; view.text.addedTo = pop.querySelector("#dAddedTo").value;
      view.text.updatedFrom = pop.querySelector("#dUpdatedFrom").value; view.text.updatedTo = pop.querySelector("#dUpdatedTo").value;
      dd.renderChip(); reload(); }); },
    summary: () => { const n = ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].filter((k) => view.text[k]).length; return "Dates: " + (n ? n + " set" : "Any"); },
    isOn: () => ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].some((k) => view.text[k]),
  });
  multi("leadStatus", "Lead status", () => fromFacet(facets && facets.leadStatuses));
  $("f-name").innerHTML = '<input type="text" id="nameSearch" placeholder="Business name contains…" style="border-radius:99px;padding:4px 11px">';
  let typing; $("nameSearch").oninput = () => { clearTimeout(typing); typing = setTimeout(() => { view.text.q = $("nameSearch").value.trim(); reload(); }, 300); };
  $("f-clear").innerHTML = '<button type="button" class="link" id="clearFilters">Clear filters</button>';
  $("clearFilters").onclick = () => {
    Object.values(f).forEach((d) => d.selected.clear());
    view.text = {}; $("nameSearch").value = "";
    Object.values(f).forEach((d) => d.renderChip());
    reload();
  };
}
function industryOfCategory(cat) {
  if (!tree) return "Other";
  for (const i of tree.industries) if (i.categories.some((c) => c.name.toLowerCase() === cat.toLowerCase())) return i.industry;
  return "Other";
}

function query() {
  const p = new URLSearchParams({ page: view.page, sort: view.sort, dir: view.dir });
  if (view.scope) view.scope.forEach((id) => p.append("search_id", id));
  const add = (key, dd) => dd && dd.selected.forEach((v) => p.append(key, v));
  add("state", f.state); add("city", f.city); add("neighborhood", f.neighborhood); add("postal_code", f.postal);
  add("industry", f.industry); add("category", f.category); add("exclude_category", f.exclude);
  add("status", f.status); add("verified", f.verified); add("location", f.location); add("price", f.price); add("attribute", f.attribute);
  add("reviews", f.reviews); add("phone_type", f.phoneType); add("lead_status", f.leadStatus);
  const one = (dd) => [...dd.selected][0] || "";
  if (one(f.top100)) p.set("top100", "1");
  if (one(f.photos)) p.set("min_photos", one(f.photos));
  const rating = one(f.rating); if (rating) p.set(rating.startsWith("min:") ? "min_rating" : "max_rating", rating.slice(4));
  const pos = one(f.position); if (pos) p.set(pos.startsWith("rank:") ? "max_rank" : "top_pct", pos.split(":")[1]);
  if (one(f.phone)) p.set("phone", one(f.phone));
  if (one(f.website)) p.set("website", one(f.website));
  f.dedupe.selected.forEach((v) => p.set("dedupe_" + v, "1"));
  if (view.text.radius && view.text.near) { p.set("radius_miles", view.text.radius); p.set("near", view.text.near); }
  const map = { q: "q", addedFrom: "added_from", addedTo: "added_to", updatedFrom: "updated_from", updatedTo: "updated_to" };
  for (const [k, key] of Object.entries(map)) if (view.text[k]) p.set(key, view.text[k]);
  return p;
}

function useScope(searchIds, label) {
  view.scope = searchIds && searchIds.length ? searchIds : null;
  view.scopeLabel = label || "";
  view.page = 1;
  $("emptyState").hidden = true; $("resultsBody").hidden = false; $("filtersCard").hidden = false;
  refreshAll();
}
// The list must never depend on the filter counts: if the counts fail, the businesses still show.
async function refreshAll() {
  try { await loadFacets(); } catch (err) { console.error("filter counts failed", err); }
  await loadLeads();
}
function reload() { view.page = 1; loadLeads(); }

async function loadFacets() {
  const p = new URLSearchParams();
  if (view.scope) view.scope.forEach((id) => p.append("search_id", id));
  facets = await api("/api/leads/facets?" + p);
  Object.values(f).forEach((d) => d.refresh());
}

async function loadLeads() {
  if ($("resultsBody").hidden) return;
  const data = await api("/api/leads?" + query());
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $("count").textContent = data.total.toLocaleString() + " business" + (data.total === 1 ? "" : "es");
  $("dupInfo").textContent = data.duplicatesHidden ? "(" + data.duplicatesHidden + " duplicate" + (data.duplicatesHidden === 1 ? "" : "s") + " hidden)" : "";
  const running = view.scope ? pulls.filter((p) => view.scope.includes(p.id) && ["pending", "scraping", "ingesting"].includes(p.status)).length : 0;
  $("scopeInfo").innerHTML = (view.scope ? '<span class="pill">' + esc(view.scopeLabel || view.scope.length + " pulls") + '</span> <button type="button" class="link small" id="clearScope">show everything we have</button>' : '<span class="pill">everything collected</span>') +
    (running ? ' <span class="pill warn">' + running + " still collecting…</span>" : "") +
    (phoneStatus ? ' <span class="pill ' + (phoneStatus.startsWith("Phone checks paused") ? "bad" : "warn") + '">' + esc(phoneStatus) + "</span>" : "") +
    (data.nearNotFound ? ' <span class="pill bad">no businesses with a map position in that place yet</span>' : "");
  if ($("clearScope")) $("clearScope").onclick = () => useScope(null, "");
  $("pageInfo").textContent = "Page " + data.page + " of " + pages;
  $("prevBtn").disabled = data.page <= 1; $("nextBtn").disabled = data.page >= pages;
  $("rows").innerHTML = data.results.length ? data.results.map((l) => {
    const type = l.phone_type || (l.gbp_phone_formatted ? "unchecked" : "");
    const site = isWebLink(l.website) ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">' + esc(l.website_domain || l.website.replace(/^https?:\\/\\/(www\\.)?/, "").split(/[/?#]/)[0]) + "</a>" : '<span class="muted">None</span>';
    const name = isWebLink(l.gbp_url) ? '<a href="' + esc(l.gbp_url) + '" target="_blank" rel="noopener">' + esc(l.business_name) + "</a>" : esc(l.business_name);
    const verified = l.is_claimed === 0 ? '<span class="pill bad">Not verified</span>' : '<span class="pill ok">Verified</span>';
    const status = l.business_status === "operational" ? '<span class="pill ok">Open</span>'
      : '<span class="pill ' + (l.business_status === "permanently_closed" ? "bad" : "warn") + '">' + esc(STATUS_LABELS[l.business_status] || l.business_status) + "</span>";
    const loc = l.has_street_address === 0 ? "Service area" : l.has_street_address === 1 ? "Physical" : "";
    // data-label lets small screens show each business as a labelled card instead of a wide row.
    const cell = (label, html, cls) => '<td data-label="' + label + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + html + "</td>";
    return "<tr>" + cell("Business", name, "name") + cell("Category", esc(l.gbp_category)) + cell("Phone", esc(l.gbp_phone_raw)) +
      cell("Phone type", (type === "unchecked" && l.phone_check_requested ? "Checking…" : esc(PHONE_LABELS[type] || "")) + (l.phone_carrier ? ' <span class="muted">' + esc(l.phone_carrier) + "</span>" : "") +
        (type === "unchecked" && !l.phone_check_requested ? ' <button type="button" class="link small" data-checkphone="' + esc(l.id) + '">Check</button>'
          : l.phone_type && l.gbp_phone_formatted ? ' <button type="button" class="link small recheck" data-recheckphone="' + esc(l.id) + '" title="Check this number again">↻</button>' : ""), "type-" + esc(type)) +
      cell("Website", site) + cell("Rating", esc(l.rating ?? "")) + cell("Reviews", esc(l.review_count ?? "")) + cell("Position", esc(l.gbp_rank ?? "")) +
      cell("Verified", verified) + cell("Status", status) + cell("Location", esc(loc)) + cell("City", esc(l.city)) + cell("State", esc(l.state)) +
      cell("Neighborhood", esc(l.neighborhood)) + cell("Added", esc(l.lead_date)) + "</tr>";
  }).join("") : '<tr><td colspan="15" class="empty-state">' + (running ? "Still collecting. Results appear here as they arrive." : "No businesses match these filters.") + "</td></tr>";
}

document.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => {
  if (view.sort === th.dataset.sort) view.dir = view.dir === "asc" ? "desc" : "asc";
  else { view.sort = th.dataset.sort; view.dir = ["name", "city", "category", "rank"].includes(th.dataset.sort) ? "asc" : "desc"; }
  document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted", "asc"));
  th.classList.add("sorted"); if (view.dir === "asc") th.classList.add("asc");
  loadLeads();
});
$("prevBtn").onclick = () => { view.page--; loadLeads(); };
$("nextBtn").onclick = () => { view.page++; loadLeads(); };
// Phone checks on demand: one business (Check / ↻) or every unchecked phone matching the filters.
async function requestPhones(body, qs) {
  const preview = await postJson("/api/phones/request" + (qs ? "?" + qs : ""), { ...body, dryRun: true });
  if (!preview.queued) { alert(preview.noPhone ? "None of these have a phone number to check." : "These phones are already checked."); return; }
  const many = preview.queued > 1;
  const msg = "Check " + num(preview.queued) + " phone number" + (many ? "s" : "") + " (mobile, landline, VoIP)?" +
    (preview.capped ? "\\n(Only the first " + num(preview.limit) + " at a time.)" : "") +
    "\\n\\nCost: free while the free checks last, otherwise up to " + money(preview.maxCostUsd) + ". It counts toward the monthly budget.";
  if (many && !confirm(msg)) return;
  await postJson("/api/phones/request" + (qs ? "?" + qs : ""), body);
  startPolling();
  await loadLeads();
}
$("rows").addEventListener("click", async (e) => {
  const one = e.target.closest("[data-checkphone]"), again = e.target.closest("[data-recheckphone]");
  if (!one && !again) return;
  const b = one || again; b.disabled = true;
  try { await requestPhones({ ids: [one ? one.dataset.checkphone : again.dataset.recheckphone], recheck: !!again }); }
  catch (err) { alert(err.message); b.disabled = false; }
});
$("checkPhonesBtn").onclick = async () => {
  const p = query(); ["page", "sort", "dir"].forEach((k) => p.delete(k));
  $("checkPhonesBtn").disabled = true;
  try { await requestPhones({}, p.toString()); } catch (err) { alert(err.message); } finally { $("checkPhonesBtn").disabled = false; }
};

// Every business matching the current filters (all pages), in the GHL upload format.
$("downloadBtn").onclick = () => {
  const p = query();
  ["page", "sort", "dir"].forEach((k) => p.delete(k));
  window.location.href = "/api/export?" + p;
};

// ---------------------------------------------------------------------------
// Pulls: polling + history
// ---------------------------------------------------------------------------
let polling = null;
async function loadPulls() { pulls = await api("/api/searches?limit=500"); return pulls; }
let pollBusy = false, phoneStatus = "", lastResultsRefresh = 0;
async function pollActive() {
  if (pollBusy) return; // a slow step (e.g. phone checks) is still running
  pollBusy = true;
  try {
    await loadPulls();
    const active = pulls.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
    await Promise.all(active.map((s) => api("/api/searches/" + s.id + "/sync", { method: "POST" }).catch(() => {})));
    await loadPulls();
    renderProgress();
    const stillPulling = pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status));
    // Phone types for pulls that asked for them (online, the minute timer also does this).
    const pc = await postJson("/api/phones/check?limit=10", {}).catch(() => null);
    const phonesPending = !!pc && pc.pending > 0 && (pc.checked > 0 || stillPulling || pc.busy);
    phoneStatus = !pc || !pc.pending ? "" : pc.checked || stillPulling || pc.busy ? "Checking phone types: " + pc.pending + " to go"
      : "Phone checks paused: " + ((pc.refused || []).map((r) => r.split(":")[0]).join(", ") || "no phone-check service set up");
    if (!stillPulling && !phonesPending && polling) { clearInterval(polling); polling = null; }
    // The results and filter counts are the heaviest reads; refresh them every 30 s, not every tick.
    // Always refresh when a pull has just finished (or polling is stopping), so new results show straight away.
    const finishedNow = active.length > 0 && !stillPulling;
    if (!$("resultsBody").hidden && (finishedNow || !polling || Date.now() - lastResultsRefresh > 30000)) { lastResultsRefresh = Date.now(); await refreshAll(); }
    if (!$("historyView").hidden) loadHistory();
    loadNotifications(); loadSpend();
  } finally { pollBusy = false; }
}
function startPolling() { if (!polling) polling = setInterval(pollActive, 5000); }

function historyQuery() {
  const p = new URLSearchParams();
  const map = { hCategory: "category", hCity: "city", hState: "state", hStatus: "status", hFrom: "from", hTo: "to" };
  for (const [id, key] of Object.entries(map)) if ($(id).value.trim()) p.set(key, $(id).value.trim());
  return p;
}
const historySelection = new Set();
async function loadHistory() {
  const rows = await api("/api/searches?" + historyQuery());
  $("historyRows").innerHTML = rows.length ? rows.map((s) => {
    const stopped = !!s.cancelled_at && s.status === "done";
    const label = stopped ? "Stopped" : PULL_LABELS[s.status] || s.status;
    const cls = s.status === "failed" ? "bad" : stopped ? "warn" : s.status === "done" ? "ok" : "warn";
    const biz = s.status === "done" && !s.results_count ? '<span class="muted">none on Google here</span>'
      : s.leads_in_database || s.results_count ? num(s.leads_in_database || 0) + (s.new_leads_count != null && s.new_leads_count !== s.leads_in_database ? ' <span class="muted">(' + num(s.new_leads_count) + " new)</span>" : "") : '<span class="muted">—</span>';
    const finished = s.status === "done" || s.status === "failed";
    const est = s.estimated_cost != null ? s.estimated_cost : s.cost_estimate;
    const cost = finished && s.cost_apify ? money(s.cost_apify) : est ? "~" + money(est) : finished ? money(0) : "";
    const test = s.apify_actor_id === "dataforseo-test" ? ' <span class="pill">test</span>' : "";
    const note = s.error || "";
    return '<tr><td><input type="checkbox" data-pick="' + esc(s.id) + '"' + (historySelection.has(s.id) ? " checked" : "") + "></td>" +
      "<td>" + esc(ago(s.created_at)) + "</td><td>" + esc(s.category) + test + "</td><td>" + (s.city ? esc(s.city) + ", " : "all of ") + esc(s.region_name || s.state || s.country || "") + "</td>" +
      '<td><span class="pill ' + cls + '">' + esc(label) + "</span></td><td>" + biz + "</td><td>" + cost + "</td>" +
      '<td class="acts"><button class="ghost small" type="button" data-view="' + esc(s.id) + '">Open list</button>' +
      (s.status === "failed" && s.apify_run_id ? ' <button class="ghost small" type="button" data-resume="' + esc(s.id) + '" title="Carries on saving what was collected. Does not pay again.">Resume</button>' : "") +
      ((s.status === "pending" || s.status === "scraping") && !s.cancelled_at ? ' <button class="ghost small danger" type="button" data-cancel="' + esc(s.id) + '" title="Stops collecting. What it already collected is kept.">Cancel</button>' : "") + "</td></tr>" +
      (note ? '<tr class="noterow"><td></td><td colspan="7" class="hint ' + (s.status === "failed" ? "err" : "") + '">' + esc(note) + "</td></tr>" : "");
  }).join("")
    : '<tr><td colspan="8" class="empty-state">No pulls match.</td></tr>';
}$("historyRows").onclick = async (e) => {
  if (await pullAction(e, loadHistory)) return;
  const v = e.target.closest("[data-view]");
  if (v) { const p = pulls.find((x) => x.id === v.dataset.view); showPulls([v.dataset.view], p ? p.category + " in " + (p.city ? p.city + ", " : "all of ") + p.state : ""); return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { pick.checked ? historySelection.add(pick.dataset.pick) : historySelection.delete(pick.dataset.pick); $("hViewSelected").disabled = !historySelection.size; }
};
$("hViewSelected").onclick = () => showPulls([...historySelection], historySelection.size + " pulls");
let hTyping;
["hCategory", "hCity", "hState"].forEach((id) => $(id).oninput = () => { clearTimeout(hTyping); hTyping = setTimeout(loadHistory, 300); });
["hStatus", "hFrom", "hTo"].forEach((id) => $(id).onchange = loadHistory);
function showPulls(ids, label) {
  setTab("find");
  // Show everything from those pulls, including unverified/closed, until the user narrows it.
  f.verified.set([]); f.status.set([]);
  useScope(ids, label);
}

// "Find leads" and "Database" share the results table but keep their own filters and scope.
let currentTab = "find";
const tabState = { find: null, database: null };
function snapshot() {
  return {
    sel: Object.fromEntries(Object.entries(f).map(([k, d]) => [k, [...d.selected]])),
    text: { ...view.text }, scope: view.scope, label: view.scopeLabel, shown: !$("resultsBody").hidden,
  };
}
function restore(s) {
  Object.entries(f).forEach(([k, d]) => { d.selected = new Set(s.sel[k] || []); d.renderChip(); });
  view.text = { ...s.text }; $("nameSearch").value = view.text.q || "";
  view.scope = s.scope; view.scopeLabel = s.label;
}
function setTab(tab) {
  if (currentTab === "find" || currentTab === "database") tabState[currentTab] = snapshot();
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("findView").hidden = tab === "history" || tab === "team" || tab === "activity";
  $("activityView").hidden = tab !== "activity";
  $("historyView").hidden = tab !== "history";
  $("teamView").hidden = tab !== "team";
  if (tab === "history") { loadHistory(); return; }
  if (tab === "team") { loadTeam(); return; }
  if (tab === "activity") { loadSpend(); loadActivity(); loadBackups(); return; }
  $("builderCard").hidden = tab === "database";
  $("steps").hidden = tab === "database";
  $("progress").hidden = tab === "database" || !startedIds.length;
  $("pageTitle").textContent = tab === "database" ? "Database" : "Find leads";
  $("pageSub").textContent = tab === "database" ? "Everything collected so far. Filter it, then download the CSV for GHL." : "Search Google Business Profiles by place and type. Anything collected in the last 30 days is reused.";
  $("plan").hidden = tab === "database" || !lastRequest;
  const saved = tabState[tab] || defaultFilters;
  restore(saved);
  if (tab === "database") useScope(null, "");
  else if (saved.shown) useScope(saved.scope, saved.label);
  else { $("emptyState").hidden = false; $("resultsBody").hidden = true; $("filtersCard").hidden = true; }
}
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));
let defaultFilters = null;

// ---------------------------------------------------------------------------
// Signed-in user + Team (admins)
// ---------------------------------------------------------------------------
let me = null;
async function loadMe() {
  me = await api("/api/me");
  const initials = (me.name || "?").split(/ +/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  $("me").innerHTML = '<span class="avatar">' + esc(initials) + "</span><span>" + esc(me.name || "Account") + (me.role === "super_admin" ? ' <span class="pill">super admin</span>' : me.role === "admin" ? ' <span class="pill">admin</span>' : "") + "</span>" +
    '<button type="button" class="link small" id="changePw">Change password</button><button type="button" class="link small" id="signOut">Sign out</button>';
  $("teamTab").hidden = me.role !== "admin" && me.role !== "super_admin";
  $("activityTab").hidden = me.role !== "super_admin";
  $("budgetSave").disabled = me.role !== "super_admin";
  $("signOut").onclick = async () => { await postJson("/api/auth/logout", {}).catch(() => {}); location.href = "/login"; };
  $("changePw").onclick = async () => {
    const current = prompt("Your current password:"); if (!current) return;
    const next = prompt("New password (at least 10 characters):"); if (!next) return;
    try { await postJson("/api/me/password", { current, next }); alert("Password changed."); } catch (err) { alert(err.message); }
  };
}
function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}
async function loadTeam() {
  if (!$("tPassword").value) $("tPassword").value = tempPassword();
  const users = await api("/api/admin/users");
  $("teamRows").innerHTML = users.map((u) => "<tr><td>" + esc(u.name || "") + "</td><td>" + esc(u.email) + "</td><td>" + (u.role === "super_admin" ? "Super admin" : u.role === "admin" ? "Admin" : "Member") +
    "</td><td>" + (u.active ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Switched off</span>') + (u.must_change_password ? ' <span class="pill warn">temporary password</span>' : "") +
    "</td><td>" + esc(u.last_login_at ? u.last_login_at.slice(0, 16) : "never") + "</td><td>" +
    (u.id === me.id ? '<span class="muted">you</span>' : u.role === "super_admin" ? '<span class="muted">owner</span>' :
      '<button type="button" class="ghost small" data-uact="reset" data-uid="' + esc(u.id) + '">Reset password</button> ' +
      '<button type="button" class="ghost small" data-uact="' + (u.active ? "off" : "on") + '" data-uid="' + esc(u.id) + '">' + (u.active ? "Switch off" : "Switch on") + "</button> " +
      '<button type="button" class="ghost small" data-uact="' + (u.role === "admin" ? "member" : "admin") + '" data-uid="' + esc(u.id) + '">' + (u.role === "admin" ? "Make member" : "Make admin") + "</button>") +
    "</td></tr>").join("");
}
$("tAdd").onclick = async () => {
  $("tMsg").className = "hint"; $("tMsg").textContent = "Adding…";
  try {
    const email = $("tEmail").value.trim(), password = $("tPassword").value;
    await postJson("/api/admin/users", { email, name: $("tName").value.trim(), password, role: $("tRole").value });
    $("tMsg").textContent = "Added " + ($("tName").value.trim() || "them") + ". Temporary password: " + password;
    $("tEmail").value = ""; $("tName").value = ""; $("tPassword").value = tempPassword();
    loadTeam();
  } catch (err) { $("tMsg").className = "hint err"; $("tMsg").textContent = err.message; }
};
$("teamRows").onclick = async (e) => {
  const b = e.target.closest("[data-uact]"); if (!b) return;
  const id = b.dataset.uid, act = b.dataset.uact;
  let changes;
  if (act === "reset") {
    const pw = tempPassword();
    if (!confirm("Give this person the new temporary password " + pw + " ? They'll be signed out and asked to choose their own.")) return;
    changes = { password: pw };
  } else if (act === "off" || act === "on") changes = { active: act === "on" };
  else changes = { role: act };
  try {
    await api("/api/admin/users/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    if (changes.password) alert("New temporary password: " + changes.password);
    loadTeam();
  } catch (err) { alert(err.message); }
};

// ---------------------------------------------------------------------------
// Notifications (bell + Pull history), spend this month, Activity log + budget (super admin)
// ---------------------------------------------------------------------------
const ACTION_LABELS = {
  signed_in: "Signed in", signed_out: "Signed out", sign_in_failed: "Failed sign-in", password_changed: "Changed password",
  team_member_added: "Added a team member", team_member_changed: "Changed a team member", pull_started: "Started a pull",
  counts_checked: "Checked how many exist", phone_checks_started: "Started phone checks", csv_downloaded: "Downloaded a CSV",
  notification_dismissed: "Dismissed a notification", maintenance_backfill: "Ran maintenance",
  pull_cancelled: "Cancelled a pull", pull_resumed: "Resumed a pull", phone_checks_requested: "Asked for phone checks",
};
function ago(ts) {
  const d = new Date((ts || "").replace(" ", "T") + "Z"), m = Math.round((Date.now() - d) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : d.toLocaleDateString();
}
let notes = [];
function noteHtml(n) {
  return '<div class="note ' + esc(n.level) + '"><span class="dot"></span><div>' + esc(n.message) + '<div class="when">' + esc(ago(n.created_at)) +
    '</div></div><button type="button" class="ghost small" data-dismiss="' + n.id + '">Dismiss</button></div>';
}
async function loadNotifications() {
  try { notes = await api("/api/notifications"); } catch { return; }
  $("bellCount").hidden = !notes.length; $("bellCount").textContent = notes.length;
  $("bellPanel").innerHTML = notes.length ? notes.map(noteHtml).join("") : '<div class="note"><div class="muted">All clear. Nothing needs attention.</div></div>';
  $("historyAlerts").hidden = !notes.length;
  $("historyAlerts").innerHTML = notes.length ? "<h2>Needs attention</h2>" + notes.map(noteHtml).join("") : "";
}
$("bell").onclick = (e) => { e.stopPropagation(); $("bellPanel").hidden = !$("bellPanel").hidden; };
document.addEventListener("click", async (e) => {
  const d = e.target.closest("[data-dismiss]");
  if (d) { await api("/api/notifications/" + d.dataset.dismiss + "/dismiss", { method: "POST" }).catch(() => {}); return loadNotifications(); }
  if (!e.target.closest(".bellwrap")) $("bellPanel").hidden = true;
});

let spend = null;
async function loadSpend() {
  try { spend = await api("/api/budget"); } catch { return; }
  const share = spend.budget > 0 ? spend.spent / spend.budget : 1;
  $("spend").textContent = "This month: " + money(spend.spent) + " of " + money(spend.budget);
  $("spend").className = "spend" + (share >= 1 ? " bad" : share >= 0.8 ? " warn" : "");
  if ($("budgetNow")) $("budgetNow").textContent = "Spent this month: " + money(spend.spent) + " (pulling " + money(spend.pulls) + ", phone checks " + money(spend.phones) +
    ", counts " + money(spend.counts) + "), " + money(spend.left) + " left.";
  if ($("budgetInput") && document.activeElement !== $("budgetInput")) $("budgetInput").value = spend.budget;
}
$("budgetSave").onclick = async () => {
  $("budgetMsg").className = "hint"; $("budgetMsg").textContent = "Saving…";
  try { await api("/api/budget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: Number($("budgetInput").value) }) }); $("budgetMsg").textContent = "Saved."; loadSpend(); }
  catch (err) { $("budgetMsg").className = "hint err"; $("budgetMsg").textContent = err.message; }
};

const size = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
async function loadBackups() {
  const data = await api("/api/admin/backups").catch(() => null);
  if (!data) return;
  $("backupRun").disabled = !data.enabled;
  const last = data.backups.find((b) => b.status === "done");
  $("backupNow").innerHTML = data.paused ? '<span class="pill warn">Paused</span> Backups are paused until production (test data is wiped first).'
    : !data.enabled ? '<span class="pill warn">Off</span> Switch on R2 storage in Cloudflare to start nightly backups.'
    : last ? "Last good backup: " + esc(ago(last.finished_at)) + "." : "No backup yet. The first one runs tonight.";
  $("backupRows").innerHTML = data.backups.length ? data.backups.map((b) => "<tr><td>" + esc(b.id) + "</td><td>" +
    '<span class="pill ' + (b.status === "done" ? "ok" : b.status === "failed" ? "bad" : "warn") + '" title="' + esc(b.error || "") + '">' + esc(b.status === "running" ? "copying…" : b.status) + "</span></td><td>" +
    Number(b.rows_copied || 0).toLocaleString() + "</td><td>" + (b.bytes ? size(b.bytes) : "") + "</td><td>" +
    (b.status === "done" ? '<a class="small" href="/api/admin/backups/' + encodeURIComponent(b.id) + '/sql">Download</a>' : "") + "</td></tr>").join("")
    : '<tr><td colspan="5" class="muted">No backups yet.</td></tr>';
}
$("backupRun").onclick = async () => {
  $("backupMsg").className = "hint"; $("backupMsg").textContent = "Starting…";
  try { await postJson("/api/admin/backups/run", {}); $("backupMsg").textContent = "Started. It carries on in the background, about a minute per 50,000 leads."; loadBackups(); }
  catch (err) { $("backupMsg").className = "hint err"; $("backupMsg").textContent = err.message; }
};

let activityPage = 1, activityUsersLoaded = false;
function detailText(d) {
  if (!d || typeof d !== "object") return "";
  const parts = [];
  if (d.types) parts.push(d.types.join(", "));
  if (d.places) parts.push("in " + d.places.join(", "));
  if (d.searches) parts.push(d.searches + " search" + (d.searches > 1 ? "es" : ""));
  if (d.maxResults) parts.push("up to " + d.maxResults);
  if (d.estimatedCostUsd != null) parts.push("est. " + money(d.estimatedCostUsd));
  if (d.costUsd != null) parts.push(money(d.costUsd));
  if (d.checkPhones) parts.push("with phone checks");
  if (d.name) parts.push(d.name);
  if (d.role) parts.push("role: " + d.role);
  if (d.active != null) parts.push(d.active ? "switched on" : "switched off");
  if (d.passwordReset) parts.push("password reset");
  if (d.reason) parts.push(d.reason);
  if (d.filters) { const f = Object.entries(d.filters).filter(([k]) => !["page", "sort", "dir"].includes(k)); parts.push(f.length ? f.map(([k, v]) => k.replace(/_/g, " ") + ": " + v).join("; ") : "all businesses"); }
  return parts.join(" · ");
}
async function loadActivity() {
  if (!activityUsersLoaded) {
    const users = await api("/api/admin/users").catch(() => []);
    $("aUser").innerHTML = '<option value="">Everyone</option>' + users.filter((u) => u.role !== "super_admin").map((u) => '<option value="' + esc(u.id) + '">' + esc(u.name || "Unnamed") + "</option>").join("");
    activityUsersLoaded = true;
  }
  const p = new URLSearchParams({ page: activityPage });
  if ($("aUser").value) p.set("user", $("aUser").value);
  if ($("aAction").value) p.set("action", $("aAction").value);
  if ($("aFrom").value) p.set("from", $("aFrom").value);
  if ($("aTo").value) p.set("to", $("aTo").value);
  const data = await api("/api/admin/audit?" + p);
  const current = $("aAction").value;
  $("aAction").innerHTML = '<option value="">Any</option>' + data.actions.map((a) => '<option value="' + esc(a) + '"' + (a === current ? " selected" : "") + ">" + esc(ACTION_LABELS[a] || a) + "</option>").join("");
  $("activityRows").innerHTML = data.results.length ? data.results.map((r) => "<tr><td>" + esc((r.at || "").slice(0, 16)) + "</td><td>" + esc(r.user_name || "Unnamed") +
    "</td><td>" + esc(ACTION_LABELS[r.action] || r.action) + '</td><td style="white-space:normal">' + esc(detailText(r.details)) + "</td></tr>").join("")
    : '<tr><td colspan="4" class="empty-state">No activity yet.</td></tr>';
  const pages = Math.max(1, Math.ceil(data.total / 100));
  $("activityCount").textContent = data.total.toLocaleString() + " entries · page " + data.page + " of " + pages;
  $("aPrev").disabled = data.page <= 1; $("aNext").disabled = data.page >= pages;
}
["aUser", "aAction", "aFrom", "aTo"].forEach((id) => $(id).onchange = () => { activityPage = 1; loadActivity(); });
$("aPrev").onclick = () => { activityPage--; loadActivity(); };
$("aNext").onclick = () => { activityPage++; loadActivity(); };
setInterval(() => { loadNotifications(); loadSpend(); }, 60000);
(async () => {
  buildFilters();
  setStep(1);
  defaultFilters = { ...snapshot(), shown: false, scope: null, label: "" };
  try {
    await loadMe();
    loadNotifications(); loadSpend();
    const [countries, categories] = await Promise.all([api("/api/geo/countries"), api("/api/categories")]);
    geo.countries = countries; tree = categories;
    whereCountry.refresh(); what.refresh();
    await loadPulls();
    if (pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status))) startPolling();
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
})();
</script>
</body>
</html>`;
