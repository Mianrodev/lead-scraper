// Single-page dashboard served at "/". Plain HTML + JS, no build step.
// Flow: one search row (What + Where, typed with suggestions) -> one answer card ("248 in your
// database: Show them" / "Not collected yet: Collect them") that reuses stored pulls and only pulls
// (and pays for) what's missing -> the list, with one-tap filters and the full dropdowns folded away.
// The Database tab uses the same search row to filter everything collected.

import { FONT_LINKS, THEME_BOOT, THEME_BUTTON, THEME_SCRIPT, themeCss } from "./theme";

export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Finder</title>
<meta name="theme-color" content="#FBF5EA">
${FONT_LINKS}
${THEME_BOOT}
<style>
${themeCss()}
  :root { --type-landline: #175cd3; --type-toll: #6941c6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --type-landline: #84adff; --type-toll: #b692f6; } }
  :root[data-theme="dark"] { --type-landline: #84adff; --type-toll: #b692f6; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; font: 14px/1.5 var(--sans);
    background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line); padding: 10px 24px; display: flex; align-items: center; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: var(--invert-text); background: var(--invert-bg);
    font: 700 15px/1 var(--serif); }
  h1 { font: 700 18px/1.1 var(--serif); color: var(--head); margin: 0; letter-spacing: -.01em; }
  h1 small { font-family: var(--sans); }
  .pagehead h2, .stephead, .modal-head h2, .main h3 { font-family: var(--serif); color: var(--head); font-weight: 600; }
  h1 small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
  h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: -.01em; }
  .tabs { display: flex; gap: 2px; background: var(--chip); padding: 3px; border-radius: 999px; }
  .tab { padding: 6px 14px; border: none; border-radius: 999px; cursor: pointer; color: var(--muted); background: none; font: inherit; font-weight: 500; }
  .tab:hover { color: var(--text); }
  .tab.active { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
  main { padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1480px; margin: 0 auto; }
  .pagehead h2 { font-size: 22px; margin: 4px 0 2px; letter-spacing: -.02em; }
  .pagehead p { margin: 0; color: var(--muted); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); }
  input, select, button { font: inherit; }
  input[type=text], input[type=number], input[type=date], input[type=password], select { padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 9px;
    background: var(--panel); color: var(--text); transition: border-color .12s, box-shadow .12s; }
  input:focus-visible, select:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  button { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); cursor: pointer; font-weight: 600;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .08); transition: filter .12s, background .12s, border-color .12s; }
  button:hover { filter: brightness(1.06); }
  button:focus-visible { box-shadow: 0 0 0 3px var(--accent-soft); }
  button.ghost { background: var(--panel); color: var(--text); border-color: var(--line-strong); font-weight: 500; }
  button.ghost:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
  button.danger:hover { border-color: var(--bad); color: var(--bad); }
  button.link { background: none; border: none; color: var(--accent); padding: 0; box-shadow: none; font-weight: 500; }
  button.small { padding: 4px 11px; font-size: 12px; border-radius: 999px; }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  .muted { color: var(--muted); } .hint { font-size: 12px; color: var(--muted); }
  .err { color: var(--bad); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  code { font-size: 12px; background: var(--chip); padding: 1px 5px; border-radius: 5px; }
  .line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .tag { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 2px 4px 2px 9px; font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .tag button { background: none; border: none; color: inherit; padding: 0 4px; cursor: pointer; font-size: 13px; line-height: 1; box-shadow: none; }

  /* One search row: What / Where (type-ahead with chips), distance, data, Search */
  .sbar { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
  .sfield { position: relative; flex: 1 1 260px; min-width: 0; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--panel); padding: 5px 10px 6px; }
  .sfield:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .slbl { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .chipbox { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-height: 28px; cursor: text; }
  .chipbox input[type=text] { flex: 1; min-width: 110px; border: none; outline: none; padding: 3px 2px; background: transparent; box-shadow: none; font-size: 15px; }
  .chipbox input[type=text]:focus-visible { box-shadow: none; }
  .tag.more { cursor: pointer; padding-right: 9px; }
  .aclist { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 45; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); padding: 4px; max-height: 320px; overflow-y: auto; }
  .acopt { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .acopt.on, .acopt:hover { background: var(--accent-soft); }
  .acsub { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .acact { color: var(--accent); font-weight: 600; }
  .sbar > select { border-radius: 12px; }
  .seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 12px; overflow: hidden; background: var(--panel); }
  .seg label { position: relative; display: flex; align-items: center; padding: 0 14px; cursor: pointer; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .seg input { position: absolute; opacity: 0; pointer-events: none; }
  .seg label.on { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .seg label:focus-within { outline: 2px solid var(--accent); outline-offset: -2px; }
  #findBtn { padding: 10px 26px; font-size: 15px; border-radius: 12px; }
  .sfoot { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-top: 8px; font-size: 13px; }
  .sfoot:empty { display: none; }
  .optbox { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); display: grid; gap: 10px; }
  .olbl { width: 96px; flex: none; font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .dbmode .findonly { display: none !important; }
  .examples { margin-top: 10px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; align-items: center; }
  /* The answer to a search: one line per situation, one button each */
  .rline { display: flex; justify-content: space-between; align-items: center; gap: 10px 16px; flex-wrap: wrap; padding: 10px 0; }
  .rline + .rline { border-top: 1px solid var(--line); }
  .rtext { font-size: 15px; }
  .rtext .big { font: 700 24px/1.1 var(--serif); color: var(--head); letter-spacing: -.02em; margin-right: 2px; }
  .rprob { font-size: 13px; color: var(--warn); padding: 3px 0; }
  .rprob.bad { color: var(--bad); } .rprob.info { color: var(--accent-strong); }
  .rprob button.link { font-size: 13px; margin-left: 4px; }
  .rlinks { display: flex; gap: 6px 16px; flex-wrap: wrap; align-items: center; margin-top: 6px; font-size: 13px; }
  .rlinks button.link, .sfoot button.link { padding: 0; }
  /* Results: quick filters + big count */
  .quick { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .qchip { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); font-weight: 500; box-shadow: none; padding: 5px 12px; font-size: 13px; }
  .qchip:hover { border-color: var(--accent-line); filter: none; }
  .qchip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
  .bigcount { font: 700 22px/1.1 var(--serif); color: var(--head); letter-spacing: -.02em; }
  @media (max-width: 760px) { .sfield, .sbar > select, .seg, #findBtn { flex: 1 1 100%; } .seg label { flex: 1; justify-content: center; padding: 9px 8px; } .olbl { width: 100%; } }

  .me { margin-left: auto; align-self: center; display: flex; gap: 12px; align-items: center; font-size: 13px; color: var(--muted); padding-bottom: 8px; }
  .spend { font-size: 12px; padding: 3px 9px; border-radius: 99px; background: var(--bg); white-space: nowrap; }
  .spend.warn { background: var(--warn-soft); color: var(--warn); } .spend.bad { background: var(--bad-soft); color: var(--bad); }
  .bellwrap { position: relative; }
  .bell { background: none; border: 1px solid var(--line-strong); border-radius: 99px; padding: 3px 9px; color: var(--text); position: relative; }
  .bell .badge { position: absolute; top: -6px; right: -6px; background: var(--bad); color: var(--panel); border-radius: 99px; font-size: 11px; padding: 0 6px; font-weight: 700; }
  .bellpanel { position: absolute; right: 0; top: calc(100% + 6px); width: min(380px, 92vw); max-height: 420px; overflow-y: auto; background: var(--panel); border: 1px solid var(--line-strong);
    border-radius: 12px; box-shadow: var(--shadow-pop); z-index: 40; padding: 6px; }
  .note { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 8px; font-size: 13px; color: var(--text); }
  .note + .note { border-top: 1px solid var(--line); }
  .note .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--warn); }
  .note.error .dot { background: var(--bad); } .note.info .dot { background: var(--accent); }
  .note .when { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .note button { margin-left: auto; flex: none; }

  /* Category picker: a centered pop-up window over the page */
  .modal-backdrop { position: fixed; inset: 0; z-index: 50; background: var(--backdrop); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal { width: min(1120px, 100%); height: min(780px, 100%); background: var(--panel); border-radius: 16px; box-shadow: var(--shadow-pop);
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
  .side .cnt.some { background: var(--accent); color: var(--on-accent); border-radius: 99px; padding: 1px 7px; font-weight: 700; }
  .main { overflow-y: auto; padding: 20px 24px 28px; }
  .main .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
  .main h3 { font-size: 20px; margin: 0 0 2px; }
  .main .sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 20px 0 10px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .tile { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line-strong); border-radius: 10px; padding: 11px 12px; cursor: pointer;
    background: var(--panel); text-align: left; font-size: 14px; color: var(--text); line-height: 1.3; transition: border-color .12s, background .12s; }
  .tile:hover { border-color: var(--accent-line); background: var(--accent-soft); }
  .tile .tick { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--line-strong); display: grid; place-items: center; font-size: 11px; color: var(--on-accent); }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .tile.on .tick { background: var(--accent); border-color: var(--accent); }
  .tile .star { margin-left: auto; color: var(--warn); font-size: 12px; }
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
    box-shadow: var(--shadow-pop); padding: 8px; display: none; }
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
  button.pill.scorebtn { border: none; box-shadow: none; cursor: pointer; padding: 1px 9px; font: inherit; font-size: 12px; font-weight: 700; }
  .table-wrap { overflow-x: auto; }
  .nowrap { white-space: nowrap; }
  .cellnote { font-size: 12px; margin-top: 2px; } .bad-text { color: var(--bad); } .ok-text { color: var(--ok); }
  td[data-label="Website"] a { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--panel-2); }
  th[data-sort] { cursor: pointer; user-select: none; }
  th.sorted::after { content: " ▾"; } th.sorted.asc::after { content: " ▴"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  .type-mobile { color: var(--ok); } .type-toll_free { color: var(--type-toll); } .type-landline { color: var(--type-landline); }
  .empty-state { text-align: center; padding: 56px 20px; color: var(--muted); }
  .empty-state strong { display: block; color: var(--text); font-size: 16px; margin-bottom: 6px; }
  .history-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  @media (max-width: 760px) { .fgroup > .glabel { width: 100%; } }

  /* Phones and small tablets */
  @media (max-width: 760px) {
    header { flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px 0; }
    header h1 { margin-bottom: 4px; }
    .me { order: 2; margin-left: auto; padding-bottom: 4px; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .tabs { order: 3; width: 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
    .tab { white-space: nowrap; padding: 8px 12px; }
    main { padding: 10px 10px 32px; gap: 10px; }
    .card { padding: 12px; border-radius: 12px; }
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

  /* Filters: main row, "Showing" chips, more filters */
  .activechips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 24px; }
  details.morefilters > summary { cursor: pointer; color: var(--accent); font-weight: 600; list-style: none; display: inline-flex; gap: 8px; align-items: center; }
  details.morefilters > summary::-webkit-details-marker { display: none; }
  details.morefilters > summary::before { content: "▸"; } details.morefilters[open] > summary::before { content: "▾"; }
  details.morefilters[open] { display: flex; flex-direction: column; gap: 8px; }
  /* Store launch checklist */
  .launch { margin-top: 10px; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--panel-2); }
  .launchlist { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
  .launchlist li { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: start; font-size: 13px; }
  .launchlist .ck { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; border: 1.5px solid var(--line-strong); color: var(--muted); }
  .launchlist li.done .ck { background: var(--ok); border-color: var(--ok); color: var(--panel); }
  .launchlist li.done b { color: var(--muted); font-weight: 500; }
  .packrow { margin-top: 4px; }
  /* Admin sections */
  .subtabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .subtabs button { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); font-weight: 500; box-shadow: none; padding: 7px 14px; }
  .subtabs button:hover { border-color: var(--accent-line); filter: none; }
  .subtabs button.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
  .secoff { display: none !important; }
  .cardfail { margin-bottom: 10px; }
  details.dev { margin-top: 8px; } details.dev > summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  /* Results toolbar */
  .baractions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .dlgroup { display: inline-flex; gap: 6px; align-items: center; } #downloadBtn { white-space: nowrap; }
  .dlgroup select { padding: 4px 8px; font-size: 12px; border-radius: 999px; }
  .actmenu { position: absolute; right: 0; top: calc(100% + 6px); width: min(340px, 92vw); background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); z-index: 40; padding: 6px; display: flex; flex-direction: column; }
  .actmenu[hidden] { display: none; }
  .actmenu .mhead { font-size: 12px; color: var(--muted); padding: 6px 10px 8px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .actmenu > button { background: none; border: none; color: var(--text); text-align: left; box-shadow: none; padding: 8px 10px; border-radius: 8px; display: flex; flex-direction: column; gap: 2px; font-weight: 600; }
  .actmenu > button:hover { background: var(--chip); filter: none; }
  .actmenu > button small { font-weight: 400; color: var(--muted); font-size: 12px; }
  .actmenu .mt { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .cost { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--warn-soft); color: var(--warn); white-space: nowrap; }
  .cost.free { background: var(--ok-soft); color: var(--ok); }
  .actmenu.cols { width: 230px; max-height: 60vh; overflow-y: auto; }
  .actmenu.cols label { display: flex; gap: 8px; align-items: center; padding: 5px 10px; font-size: 13px; cursor: pointer; }
  .pagerbar { border-bottom: none; border-top: 1px solid var(--line); }
  .pagehead { position: relative; }
  .headacts { float: right; margin: 4px 0 0 12px; }
  @media (max-width: 760px) { .baractions { width: 100%; } .dlgroup { width: 100%; } .dlgroup select { flex: 1; } .headacts { float: none; margin: 0 0 8px; } }  /* In-page dialogs and messages */
  .uitext { margin: 0; white-space: pre-line; }
  .copyrow { display: flex; gap: 8px; } .copyrow input { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, Consolas, monospace; }
  button.dangerbtn { background: var(--bad); border-color: var(--bad); color: var(--panel); }
  .toasts { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 70; display: flex; flex-direction: column; gap: 8px; align-items: center; width: min(560px, calc(100vw - 24px)); pointer-events: none; }
  .toastx { pointer-events: auto; display: flex; gap: 12px; align-items: center; background: var(--invert-bg); color: var(--invert-text); padding: 10px 12px 10px 16px; border-radius: 12px;
    box-shadow: var(--shadow-pop); font-weight: 500; max-width: 100%; animation: toastin .18s ease-out; }
  .toastx > span { flex: 1; } .toastx.bad { background: var(--bad); color: var(--panel); } .toastx.ok { background: var(--ok); color: var(--panel); }
  .toastx button.link { color: inherit; font-weight: 700; text-decoration: underline; } .toastx .tx { text-decoration: none; font-size: 18px; line-height: 1; opacity: .8; }
  @keyframes toastin { from { transform: translateY(8px); opacity: 0; } }  /* Header: tabs never wrap inside; on narrower screens they move to their own row */
  .tab { white-space: nowrap; } h1 { white-space: nowrap; }
  @media (max-width: 1320px) {
    header { flex-wrap: wrap; row-gap: 8px; padding-bottom: 8px; }
    .tabs { order: 3; width: 100%; overflow-x: auto; scrollbar-width: none; }
    .me { margin-left: auto; }
  }
  /* Account menu, banner */
  .menuwrap { position: relative; }
  .acct { display: inline-flex; align-items: center; gap: 8px; background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); padding: 3px 10px 3px 3px; font-weight: 500; box-shadow: none; }
  .acct:hover { border-color: var(--accent-line); filter: none; }
  .acctmenu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 220px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); z-index: 40; padding: 6px; display: flex; flex-direction: column; }
  .acctmenu[hidden] { display: none; }
  .acctmenu .who { padding: 6px 10px 8px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-wrap: anywhere; }
  .acctmenu button { background: none; border: none; color: var(--text); text-align: left; font-weight: 500; box-shadow: none; padding: 8px 10px; border-radius: 8px; }
  .acctmenu button:hover { background: var(--chip); filter: none; }
  .banner { margin: 12px 24px 0; display: flex; gap: 10px; align-items: flex-start; }
  .banner > span { flex: 1; }
  .banner button.link { color: inherit; font-size: 18px; line-height: 1; }
  .mename { white-space: nowrap; } #me { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  @media (max-width: 760px) { .mename { display: none; } .banner { margin: 10px 10px 0; } }
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
  /* Search answer, progress */
  details.breakdown > summary { cursor: pointer; color: var(--accent); font-weight: 600; list-style: none; }
  details.breakdown > summary::-webkit-details-marker { display: none; }
  details.breakdown > summary::before { content: "▸ "; } details[open] > summary::before { content: "▾ "; }
  .callout { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
  .callout.bad { background: var(--bad-soft); color: var(--bad); } .callout.warn { background: var(--warn-soft); color: var(--warn); }
  .plan .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button.big { padding: 11px 22px; font-size: 15px; }
  details.breakdown table { margin-top: 8px; }
  .proghead { font-size: 15px; margin: 0 0 4px; }
  .prow { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) minmax(0, 1.6fr) 84px; gap: 8px 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
  .pname { font-weight: 600; }
  .pbar { height: 8px; border-radius: 99px; background: var(--chip); overflow: hidden; }
  .pbar i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .6s; }
  .pbar.run i { background: linear-gradient(90deg, var(--accent), var(--accent-line), var(--accent)); background-size: 200% 100%; animation: flow 1.4s linear infinite; }
  .pbar.ok i { background: var(--ok); } .pbar.bad i { background: var(--bad); } .pbar.warn i { background: var(--warn); }
  @keyframes flow { to { background-position: -200% 0; } }
  .pstate { font-size: 13px; } .pstate.ok { color: var(--ok); } .pstate.bad { color: var(--bad); } .pstate.warn { color: var(--warn); } .pstate.run { color: var(--accent); }
  .perr { grid-column: 1 / -1; font-size: 12px; color: var(--bad); }
  tr.noterow td { border-top: none; padding-top: 0; white-space: normal; }
  td.acts { white-space: nowrap; }
  @media (max-width: 760px) {
    .prow { grid-template-columns: minmax(0, 1fr) auto; }
    .prow .pbar { grid-column: 1 / -1; order: 3; }
  }
  .pill.free { background: var(--ok-soft); color: var(--ok); }
  button.recheck { opacity: .45; margin-left: 2px; } tr:hover button.recheck { opacity: 1; }
  input.masked { -webkit-text-security: disc; }
  .callout.info { background: var(--accent-soft); color: var(--accent-strong); }
  .plan .muted-row td { color: var(--muted); }
  .planmsg:empty { display: none; }
  .filterwarn { margin-left: 6px; }
  .modal.small { width: min(420px, 100%); height: auto; grid-template-rows: auto auto auto; }
  .modal.small .body { padding: 16px 22px; display: grid; gap: 10px; }
  .modal.small label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
  .modal.small input { width: 100%; padding: 9px 11px; }
  .modal.small.wide { width: min(620px, 100%); max-height: 92vh; overflow: auto; }
  .modal.small textarea { width: 100%; padding: 9px 11px; font: inherit; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--panel); color: var(--text); }
  .modal.small .line label { display: inline-grid; }
  .lnote { border-top: 1px solid var(--line); padding: 8px 0; font-size: 13px; white-space: pre-wrap; }
  .dangerrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border-top: 1px dashed var(--line-strong); padding-top: 10px; margin-top: 4px; }
  .dangerrow select { padding: 4px 8px; font-size: 12px; }
  .ldsum { display: grid; gap: 8px; }
  .ldbox { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--panel-2); font-size: 13px; }
  .ldbox b { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 4px; }
  .ldbox ul { margin: 0; padding-left: 18px; }
  .ldnext { border-color: var(--accent-line); background: var(--accent-soft); }
  .lnote .who { color: var(--muted); font-size: 12px; }
  .stagepill { cursor: pointer; }
  /* Pipeline board */
  .kanban { display: grid; grid-template-columns: repeat(6, minmax(210px, 1fr)); gap: 10px; overflow-x: auto; align-items: start; padding-bottom: 6px; }
  .kcol { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 8px; min-height: 220px; }
  .kcol.over { border-color: var(--accent); background: var(--accent-soft); }
  .kcol h3 { font-size: 13px; margin: 2px 4px 8px; display: flex; justify-content: space-between; }
  .kcard { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-bottom: 6px; cursor: grab; font-size: 13px; box-shadow: var(--shadow); }
  .kcard:hover { border-color: var(--accent-line); }
  .kcard .sub { color: var(--muted); font-size: 12px; }
  .kcard .sc { float: right; font-weight: 700; font-size: 12px; margin-left: 6px; }
  .kcard .kstage { margin-top: 6px; width: 100%; padding: 3px 6px; font-size: 12px; }
  /* Overview */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .stat { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .stat b { display: block; font-size: 22px; letter-spacing: -.02em; }
  .stat span { color: var(--muted); font-size: 12px; }
  .bars { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
  .bars div { flex: 1; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 2px; }
  .hbar { display: grid; grid-template-columns: 100px 1fr 70px; gap: 8px; align-items: center; font-size: 13px; margin: 5px 0; }
  .hbar i { display: block; height: 10px; background: var(--accent); border-radius: 99px; }
  .tl { font-size: 13px; padding: 6px 0; border-top: 1px solid var(--line); }
  .tl .who { color: var(--muted); font-size: 12px; }
  /* Map, openers */
  /* isolation: Leaflet's own layers (z-index 400-1000) stay under pop-ups and the sticky header */
  #leadMap { height: 520px; border-radius: 12px; border: 1px solid var(--line); position: relative; z-index: 0; isolation: isolate; }
  .opener { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
  .opener pre { white-space: pre-wrap; font: inherit; margin: 4px 0 0; }
  .opener .h { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 12px; color: var(--muted); }
  .ta { width: 100%; padding: 8px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--panel); color: var(--text); font: inherit; }
  @media (max-width: 700px) { .kanban { grid-template-columns: repeat(6, 78vw); } #leadMap { height: 380px; } }
</style>
</head>
<body>
<header>
  <div class="brand"><div class="logo">LF</div><h1>Lead Finder<small id="roleLabel"></small></h1></div>
  <div class="tabs">
    <button class="tab active" data-tab="find" type="button">Find leads</button>
    <button class="tab" data-tab="database" type="button">Database</button>
    <button class="tab" data-tab="pipeline" type="button">Pipeline</button>
    <button class="tab" data-tab="overview" type="button">Overview</button>
    <button class="tab" data-tab="history" type="button">Search history</button>
    <button class="tab" data-tab="team" type="button" id="teamTab" hidden>Team</button>
    <button class="tab" data-tab="activity" type="button" id="activityTab" hidden>Admin</button>
  </div>
  <div class="me">
    <span id="spend" class="spend" title="Spent this month (collecting, phone checks, counts) out of the monthly budget"></span>
    <div class="bellwrap"><button type="button" id="bell" class="bell" aria-label="Notifications">🔔<span id="bellCount" class="badge" hidden></span></button>
      <div id="bellPanel" class="bellpanel" hidden></div></div>
    ${THEME_BUTTON}
    <div class="menuwrap"><button type="button" class="acct" id="acctBtn" aria-haspopup="true" aria-expanded="false" aria-controls="acctMenu"><span id="me"></span><span aria-hidden="true">▾</span></button>
      <div class="acctmenu" id="acctMenu" hidden><div class="who" id="acctWho"></div>
        <button type="button" id="changePw">Change password</button><button type="button" id="signOut">Sign out</button></div></div>
  </div>
</header>
<div id="limitBanner" class="callout bad banner" hidden><span id="limitText"></span><button type="button" class="link" id="limitClose" aria-label="Close this message">×</button></div>

<main id="findView">
  <div class="pagehead"><div class="headacts"><button type="button" class="ghost" id="uploadBtn" title="Add businesses you already have, from a CSV file">⬆ Add my own list</button></div><h2 id="pageTitle">Find leads</h2><p id="pageSub">Search by type and place. You see the count and any cost first.</p></div>
  <section class="card" id="searchCard">
    <div class="sbar" role="search">
      <div class="sfield"><label class="slbl" for="whatInput">What</label>
        <div class="chipbox" id="whatBox"><input type="text" id="whatInput" autocomplete="off" spellcheck="false" placeholder="Plumber, dentist, roofer…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whatList"></div>
        <div class="aclist" id="whatList" role="listbox" aria-label="Types of business" hidden></div></div>
      <div class="sfield"><label class="slbl" for="whereInput">Where</label>
        <div class="chipbox" id="whereBox"><input type="text" id="whereInput" autocomplete="off" spellcheck="false" placeholder="State or city" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whereList"></div>
        <div class="aclist" id="whereList" role="listbox" aria-label="Places" hidden></div></div>
      <select id="radiusMiles" class="findonly" aria-label="Distance" title="For cities: also search around them">
        <option value="">Just the place</option><option value="5">Within 5 mi</option><option value="10">Within 10 mi</option>
        <option value="25">Within 25 mi</option><option value="50">Within 50 mi</option></select>
      <div class="seg findonly" role="radiogroup" aria-label="Data">
        <label class="on" title="Open map data: name, phone, website, address, emails when listed. No ratings or reviews. Free."><input type="radio" name="source" value="free" checked>Free data</label>
        <label title="Google Maps: everything, plus rating, reviews and verified. About $5 per 1,000 businesses. You see the price first."><input type="radio" name="source" value="google">Google (paid)</label>
      </div>
      <button id="findBtn" type="button">Search</button>
    </div>
    <div class="sfoot">
      <button type="button" class="link small findonly" id="browseTypes">Browse all types</button>
      <button type="button" class="link small findonly" id="moreBtn" aria-expanded="false" aria-controls="moreOptions">More options ▾</button>
      <span id="findMsg" class="hint" role="status"></span>
    </div>
    <div class="optbox findonly" id="moreOptions" hidden>
      <div class="line"><span class="olbl">Country</span><div class="dd" id="dd-country"></div></div>
      <div class="line" id="howManyLine"><span class="olbl">How many</span>
        <label class="muted">Up to <select id="maxResults">
          <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100" selected>100</option>
          <option value="250">250</option><option value="500">500</option><option value="1000">1,000</option><option value="2500">2,500</option>
          <option value="5000">5,000</option><option value="10000">10,000</option><option value="0">No limit (everything)</option>
        </select> per search</label></div>
      <div class="line"><span class="olbl">Phones</span>
        <div class="dd" id="dd-phonetypes"></div>
        <label title="Mobile, landline or internet number. Google doesn't say, so it's checked after collecting."><input type="checkbox" id="checkPhones"> Check phone types after collecting</label>
        <span class="hint">Small fee per number.</span></div>
      <div class="line" id="countLine"><span class="olbl">Count first</span>
        <label title="See how many exist before collecting. Remembered for a week."><input type="checkbox" id="withCounts" checked> Count on Google</label>
        <select id="countWebsite" aria-label="Count only"><option value="">with or without a website</option><option value="no">without a website</option><option value="yes">with a website</option></select>
        <label><input type="checkbox" id="countPhone"> with a phone</label>
        <label><input type="checkbox" id="countVerified"> verified only</label>
        <span class="hint" title="These also set the matching filters on your list. Collecting always takes every business.">About 1¢ per type and place.</span></div>
    </div>
  </section>

  <section class="card" id="savedCard" hidden>
    <h2 title="New matches are counted every day (free); you get a notification when there are more">Saved searches</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Search</th><th>In your database</th><th>New</th><th></th></tr></thead>
      <tbody id="savedRows"></tbody>
    </table></div>
  </section>
  <section class="card plan" id="plan" aria-live="polite" hidden></section>

  <section class="card" id="progress" hidden></section>

  <section class="card" id="filtersCard" hidden>
    <div class="line" id="aiLine" style="margin-bottom:10px" hidden>
      <input type="text" id="aiText" placeholder="Describe it: roofers in Tampa with no website and under 20 reviews" style="flex:1;min-width:240px">
      <button type="button" id="aiGo" class="small" title="Sets the filters for you to check (about 1-2 cents)">Set filters</button>
      <span id="aiMsg" class="hint"></span>
    </div>
    <div class="filterbar" id="filterbar"></div>
  </section>

  <section class="card" id="mapCard" hidden>
    <div class="line" style="margin-bottom:8px"><strong>Map</strong><span id="mapInfo" class="hint"></span><span style="flex:1"></span>
      <button type="button" class="ghost small" id="mapDraw" title="Click the map to add corners, then press Use this area">Draw an area</button><button type="button" class="small" id="mapUse" hidden>Use this area</button>
      <button type="button" class="ghost small" id="mapClear" hidden>Clear the area</button><button type="button" class="ghost small" id="mapClose">Hide map</button></div>
    <div id="leadMap"></div>
    <div class="hint" style="margin-top:6px">Red: score under 40 (best prospects) · amber: 40-59 · green: 60+ · grey: not scored.</div>
  </section>

  <section class="card results" id="resultsCard">
    <div class="empty-state" id="emptyState">
      <strong>Type what and where, then press Search.</strong>
      <div class="examples">Try:
        <button type="button" class="ghost small" data-example="plumb|Tampa|FL">Plumbers in Tampa, FL</button>
        <button type="button" class="ghost small" data-example="dentist|Austin|TX">Dentists in Austin, TX</button>
        <button type="button" class="ghost small" data-example="roof||FL">Roofers in Florida</button></div>
    </div>
    <div id="resultsBody" hidden>
      <div class="bar">
        <div class="scope"><strong id="count" class="bigcount"></strong> <span id="dupInfo" class="muted"></span> <span id="scopeInfo"></span></div>
        <div class="baractions">
          <button class="ghost small" id="mapBtn" type="button" title="See them on a map, and draw an area to narrow the list">Map</button>
          <div class="menuwrap"><button class="ghost small" id="improveBtn" type="button" aria-haspopup="true" aria-expanded="false">Improve ▾</button>
            <div class="actmenu" id="improveMenu" hidden>
              <div class="mhead">For every business in this list. You see the price first.</div>
              <button type="button" id="checkSitesBtn"><span class="mt">Check websites <span class="cost free">Free</span></span><small>Booking, contact form, ads, emails, owner names</small></button>
              <button type="button" id="checkPhonesBtn"><span class="mt">Check phone types <span class="cost">Small fee</span></span><small>Mobile, landline or internet number</small></button>
              <button type="button" id="verifyBtn"><span class="mt">Verify emails <span class="cost">Small fee</span></span><small>So your emails don’t bounce</small></button>
              <button type="button" id="googleDetailsBtn"><span class="mt">Get Google details <span class="cost">about $5 per 1,000</span></span><small>Rating, reviews and verified, for free-data businesses</small></button>
            </div></div>
          <button class="ghost small" id="bulkBtn" type="button" title="Set the stage, or assign every business in this list to someone">Assign</button>
          <div class="menuwrap"><button class="ghost small" id="colsBtn" type="button" aria-haspopup="true" aria-expanded="false">Columns ▾</button>
            <div class="actmenu cols" id="colsMenu" hidden></div></div>
          <span class="dlgroup">
            <select id="exportFormat" aria-label="Download for">
              <option value="ghl">For GoHighLevel</option>
              <option value="cold_email">For cold email (Instantly, Smartlead)</option>
              <option value="simple">Simple spreadsheet</option>
            </select>
            <button id="downloadBtn" type="button" title="Every business in this list (all pages). Do-not-contact businesses and emails that would bounce are left out.">Download</button>
          </span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th data-sort="name">Business</th><th data-sort="score" title="Online presence score out of 100. Red (under 40) = weak online presence = the most you can sell them. Green (60+) = already strong.">Score</th><th>Stage</th><th data-sort="category">Category</th><th>Phone</th><th>Phone type</th><th>Website</th>
            <th data-sort="rating">Rating</th><th data-sort="reviews">Reviews</th><th data-sort="rank">Position</th><th>Verified</th>
            <th>Status</th><th>Location</th><th data-sort="city">City</th><th>State</th><th>Neighborhood</th><th data-sort="added" class="sorted">Added</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="bar pagerbar"><span id="pageInfo" class="muted"></span><span>
        <button class="ghost small" id="prevBtn" type="button">‹ Previous page</button> <button class="ghost small" id="nextBtn" type="button">Next page ›</button></span></div>
    </div>
  </section>
</main>

<main id="pipelineView" hidden>
  <div class="pagehead"><h2>Pipeline</h2><p>Your leads by stage. Click one for notes and next steps.</p></div>
  <section class="card">
    <div class="line"><label class="muted">Whose <select id="pWho"><option value="me">My leads</option><option value="">Everyone</option><option value="none">Nobody's yet</option></select></label>
      <input type="text" id="pSearch" placeholder="Business name…"><span id="pMsg" class="hint"></span></div>
  </section>
  <div class="kanban" id="kanban"></div>
</main>

<main id="overviewView" hidden>
  <div class="pagehead"><h2>Overview</h2><p>How the database and the pipeline are doing.</p></div>
  <section class="card"><div class="stats" id="ovStats"><div class="hint">Loading…</div></div></section>
  <section class="card"><h2>Hot leads: opened their report in the last 2 weeks</h2><div id="ovHot"></div></section>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
    <section class="card"><h2>Pipeline</h2><div id="ovStages"></div></section>
    <section class="card"><h2>New businesses per day (last 14 days)</h2><div class="bars" id="ovGrowth"></div><div class="hint" id="ovGrowthHint" style="margin-top:6px"></div></section>
  </div>
  <section class="card"><h2>By team member</h2><div class="table-wrap"><table><thead><tr><th>Who</th><th>Assigned</th><th>Untouched</th><th>Contacted / follow-up</th><th>Interested</th><th>Won</th></tr></thead><tbody id="ovReps"></tbody></table></div></section>
</main>

<main id="historyView" hidden>
  <div class="pagehead"><h2>Search history</h2><p>Every search, what it found and what it cost.</p></div>
  <section class="card" id="historyAlerts" hidden></section>
  <section class="card results">
    <div class="history-filters">
      <label class="field">Business type<input type="text" id="hCategory" placeholder="e.g. plumber"></label>
      <label class="field">City<input type="text" id="hCity" placeholder="e.g. Orlando"></label>
      <label class="field">State<input type="text" id="hState" placeholder="FL" style="width:70px"></label>
      <label class="field">Status<select id="hStatus"><option value="">Any</option><option value="done">Ready</option>
        <option value="pending">Starting</option><option value="scraping">Collecting</option><option value="ingesting">Saving</option><option value="enriching">Checking</option>
        <option value="stopped">Stopped</option><option value="failed">Failed</option></select></label>
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
    <div class="bar"><span id="historyCount" class="muted"></span><button class="ghost small" id="historyMore" type="button" hidden>Show older searches</button></div>
  </section>
</main>

<main id="teamView" hidden>
  <div class="pagehead"><h2>Team</h2><p>Who can sign in, and what they can do.</p></div>
  <section class="card">
    <h2>Add a team member</h2>
    <div class="line">
      <label class="field">Their email<input type="email" id="tEmail" placeholder="name@company.com" autocomplete="off" spellcheck="false" style="width:230px"></label>
      <label class="field">Name<input type="text" id="tName" placeholder="First Last" style="width:170px"></label>
      <label class="field">Temporary password<input type="text" id="tPassword" style="width:190px"></label>
      <label class="field">Role<select id="tRole"><option value="member">Member</option><option value="admin">Admin (can manage the team)</option></select></label>
      <button type="button" id="tAdd" style="align-self:end">Add</button>
      <span id="tMsg" class="hint" style="align-self:end"></span>
    </div>
    <div class="hint" style="margin-top:8px">They choose their own password when they first sign in.</div>
  </section>
  <section class="card results">
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody id="teamRows"></tbody>
    </table></div>
  </section>
</main>

<main id="activityView" hidden>
  <div class="pagehead"><h2>Admin</h2><p>Settings for the whole team. Only you see this page.</p></div>
  <nav class="subtabs" id="adminNav" aria-label="Admin sections">
    <button type="button" data-sec="spend">💵 Spending</button>
    <button type="button" data-sec="collect">📥 Data collection</button>
    <button type="button" data-sec="store">🛒 Online store <span id="navStoreBadge" class="pill warn" hidden></span></button>
    <button type="button" data-sec="dnc">⛔ Do not contact</button>
    <button type="button" data-sec="brand">✏️ Agency, wording &amp; score</button>
    <button type="button" data-sec="connect">🔌 Connections</button>
    <button type="button" data-sec="backup">💾 Backups</button>
    <button type="button" data-sec="log">📜 Activity log</button>
  </nav>
  <section class="card" data-sec="spend">
    <h2>Monthly spending limit</h2>
    <div class="line">
      <span id="budgetNow" class="muted"></span>
      <label class="muted">Limit per month $ <input type="number" id="budgetInput" min="0" step="5" style="width:110px"></label>
      <button type="button" id="budgetSave">Save</button>
      <span id="budgetMsg" class="hint"></span>
    </div>
    <div class="hint" style="margin-top:6px">Google searches, counts and phone checks that would go over this are refused (free data always works). It starts again on the 1st of each month.</div>
  </section>
  <section class="card" id="freeCard" data-sec="collect">
    <h2>Free data (open map data)</h2>
    <div class="line"><span id="freeNow" class="muted"></span></div>
    <div class="line" style="margin-top:8px">
      <label class="muted">Free businesses saved per day <input type="number" id="freeLimit" min="0" step="500" style="width:110px"></label>
      <button type="button" id="freeLimitSave">Save</button><span id="freeMsg" class="hint"></span>
    </div>
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Collection</th><th>Status</th><th>Businesses</th><th></th></tr></thead>
      <tbody id="freeRows"></tbody>
    </table></div>
    <h2 style="margin-top:18px">Daily free collection</h2>
    <div class="line">
      <label><input type="checkbox" id="harvestOn"> Collect from the list below every day</label>
      <label class="muted">about <input type="number" id="harvestTarget" min="100" step="500" style="width:100px"> new businesses a day</label>
      <button type="button" id="harvestSave">Save</button><span id="harvestMsg" class="hint"></span>
    </div>
    <div class="hint" id="harvestNow" style="margin-top:6px"></div>
    <div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Type and place</th><th>Last collected</th><th></th></tr></thead>
      <tbody id="harvestRows"></tbody>
    </table></div>
    <div class="hint" style="margin-top:6px" title="Each item is collected again every month, so new businesses keep arriving and closed ones are marked.">Add to this list from a Free data search: “+ Add to daily free collection”.</div>
    <div class="hint" style="margin-top:6px" title="The free database can save about 100,000 changes a day; the rest waits for the next day. 0 = no limit (paid database plan only).">The daily limit above keeps the free database within its limits.</div>
  </section>
  <section class="card" id="sitesCard" data-sec="collect">
    <h2>Website check</h2>
    <div class="line"><span id="sitesNow" class="muted"></span></div>
    <div class="line" style="margin-top:8px">
      <label><input type="checkbox" id="sitesOn"> Check new businesses' websites automatically</label>
      <label class="muted">up to <input type="number" id="sitesLimit" min="100" step="500" style="width:100px"> a day</label>
      <button type="button" id="sitesSave">Save</button><span id="sitesMsg" class="hint"></span>
    </div>
    <div class="hint" style="margin-top:6px" title="Does it load, is it secure and phone-friendly, online booking, contact form, ad tracking, chat, website builder, how old it looks, plus emails, social pages and owner names. Speed is added once the free Google speed key is set up.">Free. Each website is checked once, then the business gets a score (low = more to fix = better prospect).</div>
  </section>
  <section class="card" id="agencyCard" data-sec="brand">
    <h2>Your agency (shown on reports)</h2>
    <div class="hint">Shown at the bottom of every shared report.</div>
    <div class="line" style="margin-top:8px;flex-wrap:wrap">
      <input type="text" id="agName" placeholder="Agency name"><input type="text" id="agPhone" placeholder="Phone"><input type="text" id="agEmail" placeholder="Email"><input type="text" id="agSite" placeholder="Website">
    </div>
    <textarea id="agBlurb" rows="2" placeholder="One or two sentences: what you do for businesses like theirs" style="width:100%;margin-top:6px;padding:8px;border:1px solid var(--line-strong);border-radius:9px;background:var(--panel);color:var(--text);font:inherit"></textarea>
    <div class="line" style="margin-top:6px"><button type="button" id="agSave">Save</button><span id="agMsg" class="hint"></span></div>
  </section>
  <section class="card" id="openersCard" data-sec="brand">
    <h2>Openers (email, text and call wording)</h2>
    <div class="hint" title="Shown in each business’s pop-up, and as the First Line / SMS columns in the cold email download.">Words in {braces} are filled in per business: <span id="opFields"></span></div>
    <label class="field" style="margin-top:8px">Email subject<input type="text" id="opSubject" class="ta"></label>
    <label class="field">Email<textarea id="opEmail" rows="8" class="ta"></textarea></label>
    <label class="field">Text message<textarea id="opSms" rows="3" class="ta"></textarea></label>
    <label class="field">Call script<textarea id="opCall" rows="4" class="ta"></textarea></label>
    <div class="line" style="margin-top:6px"><button type="button" id="opSave">Save</button><button type="button" class="ghost" id="opReset">Back to the defaults</button><span id="opMsg" class="hint"></span></div>
  </section>
  <section class="card" id="formCard" data-sec="brand">
    <h2>“Free website check” form for your agency’s website</h2>
    <div class="hint" title="Their website is checked and scored automatically, and you get a notification. Spam protection is built in.">Put this form on your agency's website. Owners who fill it in are added here as “Interested”.</div>
    <div class="line" style="margin-top:8px"><a id="formLink" target="_blank" rel="noopener"></a></div>
    <textarea id="formEmbed" rows="3" readonly class="ta" style="margin-top:6px"></textarea>
    <div class="line" style="margin-top:6px"><button type="button" id="formCopy">Copy the code for your website</button><button type="button" class="ghost" id="formNew">New link (stops the old one)</button><span id="formMsg" class="hint"></span></div>
  </section>
  <section class="card" id="storeCard" data-sec="store">
    <h2>Online store <span id="stRemBadge" class="pill warn" hidden></span></h2>
    <div class="hint">Customers unlock leads in your online store with credits. They buy credits by card once card payments are switched on; until then, add credits here when a customer pays you.</div>
    <div class="launch" id="launchBox">
      <div class="line"><strong>Ready to sell?</strong> <span id="launchSummary" class="pill"></span></div>
      <ol class="launchlist" id="launchList"><li class="hint">Loading…</li></ol>
      <div class="hint" id="launchNote"></div>
    </div>
    <h2 style="margin-top:18px">Selling credits</h2>
    <div class="hint">The packs customers can buy by card (once card payments are on). Bigger packs usually get a lower price per credit. Example: 100 credits for $50, 500 for $200.</div>
    <div id="packRows" style="margin-top:8px"></div>
    <div class="line" style="margin-top:6px"><button type="button" class="ghost small" id="packAdd">+ Add a pack</button></div>
    <div class="line" style="margin-top:10px;flex-wrap:wrap">
      <label class="muted">Send emails from <input type="text" id="lsFrom" placeholder="Miami Goes Local <hello@yourdomain.com>" style="width:320px"></label>
      <label><input type="checkbox" id="lsLegal"> A lawyer has checked the legal pages</label>
      <label><input type="checkbox" id="lsPaid"> The Cloudflare Workers Paid plan is on</label>
    </div>
    <div class="line" style="margin-top:6px"><button type="button" id="lsSave">Save</button><span id="lsMsg" class="hint"></span></div>
    <div class="line" style="margin-top:8px"><span id="revenueLine" class="muted"></span></div>
    <h2 style="margin-top:18px">Store settings</h2>
    <div class="line" style="margin-top:8px"><span id="stStats" class="muted"></span></div>
    <div class="line" style="margin-top:8px;flex-wrap:wrap">
      <label class="muted">Standard lead costs <input type="number" id="stPriceFree" min="0" max="1000" step="1" style="width:80px"> credits</label>
      <label class="muted">Premium Google lead costs <input type="number" id="stPriceGoogle" min="0" max="1000" step="1" style="width:80px"> credits</label>
      <label class="muted">New customers get <input type="number" id="stWelcome" min="0" step="1" style="width:90px"> free credits when approved</label>
      <label class="muted" title="Shown to customers next to every price, e.g. 3 credits ≈ $1.50. Leave empty to hide dollar amounts.">1 credit = $ <input type="number" id="stCreditPrice" min="0" max="10000" step="0.01" placeholder="not shown" style="width:100px"></label>
    </div>
    <div class="line" style="margin-top:6px;flex-wrap:wrap">
      <input type="text" id="stBrand" placeholder="Store name">
      <label class="muted">Color <input type="color" id="stColor" style="width:48px;padding:0 2px"></label>
      <input type="text" id="stSupport" placeholder="Support email">
      <input type="text" id="stUrl" placeholder="Store web address (https://...)">
      <input type="text" id="stLogo" placeholder="Logo image address (https://...)" title="Right-click your logo on your website, Copy image address, and paste it here">
      <label><input type="checkbox" id="stSignup"> New companies can sign up</label>
    </div>
    <div class="line" style="margin-top:6px;flex-wrap:wrap">
      <label class="muted">How new companies join <select id="stSignupMode"><option value="open">Start straight away (self-serve)</option><option value="approval">I approve each one</option></select></label>
      <label class="muted">Free leads every month <input type="number" id="stFreeMonth" min="0" max="10000" step="1" style="width:90px"></label>
      <label><input type="checkbox" id="stPublic"> Let search engines list the public website and catalog (only when you're ready to launch)</label>
    </div>
    <div class="line" style="margin-top:6px"><button type="button" id="stSave">Save</button><a id="stOpen" target="_blank" rel="noopener" hidden>Open the store</a><span id="stMsg" class="hint"></span></div>
    <h2 style="margin-top:18px">Removal requests <span id="stRemCount" class="pill warn" hidden></span></h2>
    <div class="hint">Business owners who asked, on your public website, to be taken out. "Remove from everything" puts their phone, website and email on your do-not-contact list, so they're hidden everywhere, including in the store.</div>
    <div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>When</th><th>Business</th><th>Phone / website / email</th><th>From</th><th>Message</th><th>Status</th><th></th></tr></thead>
      <tbody id="stRemRows"></tbody>
    </table></div>
    <h2 style="margin-top:18px">Customers</h2>
    <div class="hint">New sign-ups wait here until you approve them. "Pause" stops a customer from buying (they keep what they bought).</div>
    <div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Company</th><th>People</th><th>Status</th><th>Credits</th><th>Free used</th><th>Leads bought</th><th>Credits spent</th><th>Last purchase</th><th></th></tr></thead>
      <tbody id="stRows"></tbody>
    </table></div>
  </section>
  <section class="card" id="dncCard" data-sec="dnc">
    <h2>Do-not-contact list</h2>
    <div class="hint" title="Clients, people who asked not to be contacted, anyone to leave alone. Matches collected later are hidden too.">Paste phone numbers, emails or websites. Every matching business is hidden from lists and downloads.</div>
    <textarea id="dncText" rows="3" placeholder="(407) 555-1234, info@joesplumbing.com, joesplumbing.com ..." style="width:100%;margin-top:8px;padding:8px;border:1px solid var(--line-strong);border-radius:9px;background:var(--panel);color:var(--text);font:inherit"></textarea>
    <div class="line" style="margin-top:6px">
      <select id="dncReason"><option value="client">Clients</option><option value="asked_to_stop">Asked not to be contacted</option><option value="other">Other</option></select>
      <input type="text" id="dncNote" placeholder="Note (optional)"><button type="button" id="dncAdd">Add to the list</button><span id="dncMsg" class="hint"></span>
    </div>
    <div class="line" style="margin-top:10px"><input type="text" id="dncSearch" placeholder="Search the list…"><span id="dncCount" class="hint"></span></div>
    <div class="table-wrap" style="margin-top:6px"><table><thead><tr><th>Entry</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody id="dncRows"></tbody></table></div>
  </section>
  <section class="card" id="weightsCard" data-sec="brand">
    <h2>What counts in the score</h2>
    <div class="hint" title="Scores are always shown out of 100, so only how the numbers compare matters.">Points for each thing (0-50). Low score = more to fix = better prospect.</div>
    <div id="weightsForm" style="margin-top:8px"></div>
    <div class="line" style="margin-top:8px"><button type="button" id="weightsSave">Save and re-score</button><button type="button" class="ghost" id="weightsReset">Back to the defaults</button><span id="weightsMsg" class="hint"></span></div>
  </section>
  <section class="card" id="apiCard" data-sec="connect">
    <h2>Connections to other tools</h2>
    <div class="hint" title="A key lets that tool read your businesses and download lists; “can collect” lets it start collections too (Google searches spend from this month’s limit). The key is shown once.">Only for Zapier, Make, a CRM or a developer’s app.</div>
    <div class="line" style="margin-top:8px">
      <input type="text" id="keyName" placeholder="Which tool? e.g. Zapier">
      <label class="muted"><input type="checkbox" id="keyCollect"> can collect</label>
      <button type="button" id="keyAdd">Make a key</button><span id="keyMsg" class="hint"></span>
    </div>
    <div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Key</th><th>Can collect</th><th>Last used</th><th></th></tr></thead><tbody id="keyRows"></tbody>
    </table></div>
    <h2 style="margin-top:18px">Tell another tool when something happens</h2>
    <div class="hint">Paste the address your tool gives you (for example a Zapier “Catch hook” address) and tick what it should hear about.</div>
    <details class="dev"><summary>Technical details for your developer</summary><div class="hint">Lead Finder posts JSON to the address. Each call has X-LeadFinder-Timestamp (unix seconds) and X-LeadFinder-Signature: sha256=HMAC-SHA256(secret, timestamp + "." + raw body), with the webhook's secret (shown once). Check the signature and reject calls whose timestamp is more than 5 minutes old.</div></details>
    <div class="line" style="margin-top:8px">
      <input type="text" id="hookUrl" placeholder="https://hooks.zapier.com/..." style="min-width:280px">
      <label class="muted"><input type="checkbox" class="hookEv" value="search.finished" checked> search finished</label>
      <label class="muted"><input type="checkbox" class="hookEv" value="saved_search.new"> new businesses for a saved search</label>
      <label class="muted"><input type="checkbox" class="hookEv" value="list.uploaded"> list uploaded</label>
      <label class="muted"><input type="checkbox" class="hookEv" value="report.viewed"> report or demo opened</label>
      <label class="muted"><input type="checkbox" class="hookEv" value="form.submitted"> website form filled in</label>
      <button type="button" id="hookAdd">Add</button><span id="hookMsg" class="hint"></span>
    </div>
    <div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Address</th><th>Events</th><th>Last delivery</th><th></th></tr></thead><tbody id="hookRows"></tbody>
    </table></div>
  </section>
  <section class="card" id="backupCard" data-sec="backup">
    <h2>Backups</h2>
    <div class="line"><span id="backupNow" class="muted"></span>
      <button type="button" class="ghost" id="backupRun">Back up now</button><span id="backupMsg" class="hint"></span></div>
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Backup</th><th>Status</th><th>Rows</th><th>Size</th><th></th></tr></thead>
      <tbody id="backupRows"></tbody>
    </table></div>
    <div class="hint" style="margin-top:6px" id="backupHint"></div>
  </section>
  <section class="card results" data-sec="log">
    <div class="history-filters">
      <label class="field">Person<select id="aUser"><option value="">Everyone</option></select></label>
      <label class="field">Action<select id="aAction"><option value="">Any</option></select></label>
      <label class="field">From<input type="date" id="aFrom"></label>
      <label class="field">To<input type="date" id="aTo"></label>
      <span class="hint" style="align-self:end">Your own actions (the owner’s) are not recorded.</span>
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
<div id="pwDialog" class="modal-backdrop" hidden><div class="modal small" role="dialog" aria-modal="true" aria-label="Change password">
  <div class="modal-head"><div class="title"><h2>Change password</h2><button type="button" class="x" id="pwClose" aria-label="Close">×</button></div></div>
  <div class="body">
    <label>Current password<input type="password" id="pwCurrent" autocomplete="current-password"></label>
    <label>New password (at least 10 characters)<input type="password" id="pwNew" autocomplete="new-password"></label>
    <label>New password again<input type="password" id="pwNew2" autocomplete="new-password"></label>
    <div id="pwMsg" class="hint"></div>
  </div>
  <div class="modal-foot"><span style="flex:1"></span><button type="button" class="ghost" id="pwCancel">Cancel</button><button type="button" id="pwSave">Change password</button></div>
</div></div>
<div id="leadDialog" class="modal-backdrop" hidden><div class="modal small wide" role="dialog" aria-modal="true" aria-label="Business">
  <div class="modal-head"><div class="title"><h2 id="ldTitle">Business</h2><button type="button" class="x" data-close="leadDialog" aria-label="Close">×</button></div></div>
  <div class="body">
    <div id="ldFacts"></div>
    <div class="line">
      <label>Stage <select id="ldStage"></select></label>
      <label>Assigned to <select id="ldAssign"></select></label>
    </div>
    <label>Add a note<textarea id="ldNote" rows="3" placeholder="Called, spoke to the owner, call back Tuesday…"></textarea></label>
    <div><button type="button" id="ldAddNote" class="small">Add note</button> <span id="ldMsg" class="hint"></span></div>
    <div class="line"><button type="button" id="ldReport" class="ghost small" title="A one-page online presence check with your agency's details, to send by email or text">📤 Share report</button>
      <button type="button" id="ldDemo" class="ghost small" title="A one-page preview website made for this business, to show what you'd build (opens it and copies the link)">🌐 Demo website</button></div>
    <details id="ldOpen" class="breakdown"><summary>Ready-made openers (email, text, call script)</summary><div id="ldOpeners"></div></details>
    <div id="ldNotes"></div>
    <div><div style="font-weight:600;margin-top:4px">Activity</div><div id="ldEvents"></div></div>
    <div class="dangerrow"><span class="hint">Don’t want to contact them?</span>
      <select id="ldDncReason" aria-label="Why"><option value="client">They’re a client</option><option value="asked_to_stop">They asked us not to contact them</option><option value="other">Other reason</option></select>
      <button type="button" id="ldDnc" class="ghost small danger" title="Hide this business (its phone, website and emails) from every list and download">Do not contact</button></div>
  </div>
</div></div>
<div id="bulkDialog" class="modal-backdrop" hidden><div class="modal small" role="dialog" aria-modal="true" aria-label="Update these businesses">
  <div class="modal-head"><div class="title"><h2>Update these businesses</h2><button type="button" class="x" data-close="bulkDialog" aria-label="Close">×</button></div></div>
  <div class="body">
    <div id="bkCount" class="hint"></div>
    <label>Stage <select id="bkStage"></select></label>
    <label>Assign to <select id="bkAssign"></select></label>
    <div id="bkMsg" class="hint"></div>
  </div>
  <div class="modal-foot"><span style="flex:1"></span><button type="button" class="ghost" data-close="bulkDialog">Cancel</button><button type="button" id="bkSave">Update</button></div>
</div></div>
<div id="uploadDialog" class="modal-backdrop" hidden><div class="modal small" role="dialog" aria-modal="true" aria-label="Upload a list">
  <div class="modal-head"><div class="title"><h2>Upload a list</h2><button type="button" class="x" data-close="uploadDialog" aria-label="Close">×</button></div></div>
  <div class="body">
    <div class="hint" title="Columns it understands: Business Name (needed), Website, Phone, Email, Address, City, State, Zip, Category. A business you already have (same phone or website) isn't added twice. Websites are checked and scored for free.">A CSV file with a header row and a Business Name column (Excel or Google Sheets: Download as CSV). Up to 2,000 businesses.</div>
    <label>Name of the list<input type="text" id="upName" placeholder="e.g. Trade show contacts"></label>
    <label>CSV file<input type="file" id="upFile" accept=".csv,text/csv,.txt"></label>
    <div id="upPreview" class="ldbox" hidden></div>
    <div id="upMsg" class="hint"></div>
  </div>
  <div class="modal-foot"><span style="flex:1"></span><button type="button" class="ghost" data-close="uploadDialog">Cancel</button><button type="button" id="upSave">Upload</button></div>
</div></div>

<div id="uiDialog" class="modal-backdrop" hidden><div class="modal small" role="dialog" aria-modal="true" aria-labelledby="uiTitle">
  <div class="modal-head"><div class="title"><h2 id="uiTitle"></h2><button type="button" class="x" id="uiX" aria-label="Close">×</button></div></div>
  <div class="body" id="uiBody"></div>
  <div class="modal-foot"><span style="flex:1"></span><button type="button" class="ghost" id="uiCancel">Cancel</button><button type="button" id="uiOk">OK</button></div>
</div></div>
<div id="toasts" class="toasts" aria-live="polite"></div>

<script>const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Amounts under a cent (e.g. one phone check) show as "<$0.01" rather than a misleading "$0.00".
// Company size ranges (src/company-facts.ts does the same on the server): "10–19", "$1M–$2.5M".
const rangeOf = (a, b) => a == null ? "" : b == null ? a.toLocaleString() + "+" : a === b ? String(a) : a.toLocaleString() + "–" + b.toLocaleString();
const shortMoney = (n) => n >= 1000000 ? "$" + (+(n / 1000000).toFixed(1)) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n;
const revenueOf = (a, b) => a == null && b == null ? "" : !a && b != null ? "under " + shortMoney(b) : b == null ? shortMoney(a) + "+" : shortMoney(a) + "–" + shortMoney(b);
const money = (v) => { const n = Number(v || 0); return n > 0 && n < 0.005 ? "<$0.01" : "$" + n.toFixed(2); };
// Only normal web addresses become links. (No slashes in this pattern: this script sits inside a
// template string, where a backslash before a slash is silently dropped.)
const isWebLink = (u) => typeof u === "string" && /^https?:[/][/]/i.test(u);
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if ((res.status === 401 || res.status === 403) && body.signIn) { location.href = "/login"; throw new Error(body.error || "Please sign in again."); }
  if (res.status === 503 && body.limit) {
    $("limitBanner").hidden = false;
    $("limitText").textContent = body.error + " Free data still works. " + (me && me.role === "super_admin" ? "You can raise the limit on the Admin page (Spending)." : "Ask the owner to raise the monthly limit.");
    if (typeof polling !== "undefined" && polling) { clearInterval(polling); polling = null; }
  }
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + ")"); e.status = res.status; e.body = body; throw e; }
  return body;
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Small things remembered on this computer (last search, columns, download format). Never needed: everything works without it. */
const mem = {
  get(k, d) { try { const v = localStorage.getItem("lf." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("lf." + k, JSON.stringify(v)); } catch (e) { /* private window: fine */ } },
};

// ---------------------------------------------------------------------------
// In-page dialogs and messages (instead of the browser's alert / confirm / prompt boxes)
// ---------------------------------------------------------------------------
/** A message at the bottom of the screen. kind: "" | "ok" | "bad". action: { label, run } (e.g. Undo). */
function toast(msg, kind, action) {
  const t = document.createElement("div");
  t.className = "toastx " + (kind || "");
  t.setAttribute("role", kind === "bad" ? "alert" : "status");
  t.innerHTML = "<span>" + esc(msg) + "</span>" + (action ? '<button type="button" class="link tact">' + esc(action.label) + "</button>" : "") +
    '<button type="button" class="link tx" aria-label="Close this message">×</button>';
  $("toasts").appendChild(t);
  const close = () => t.remove();
  t.querySelector(".tx").onclick = close;
  if (action) t.querySelector(".tact").onclick = () => { close(); action.run(); };
  setTimeout(close, kind === "bad" ? 15000 : action ? 15000 : 7000);
}
let uiResolve = null, uiOpts = {};
function uiClose(v) { $("uiDialog").hidden = true; const r = uiResolve; uiResolve = null; if (r) r(v); }
/**
 * One dialog for questions and small forms. o: { title, text | html, fields: [{ id, label, type, value, options, placeholder, hint }],
 * ok, danger, paid, cancel (false = no Cancel), confirmWord (must be typed), validate(values) -> error text }.
 * Resolves to true / false (no fields) or the values / null (fields).
 */
function uiForm(o) {
  if (uiResolve) uiClose(null);
  uiOpts = o;
  const fields = o.fields || [];
  $("uiTitle").textContent = o.title || "";
  $("uiBody").innerHTML = (o.html || (o.text ? '<p class="uitext">' + esc(o.text) + "</p>" : "")) + fields.map((fd) => "<label>" + esc(fd.label || "") +
    (fd.type === "select" ? '<select data-ui="' + esc(fd.id) + '">' + fd.options.map((op) => '<option value="' + esc(op[0]) + '"' + (String(op[0]) === String(fd.value == null ? "" : fd.value) ? " selected" : "") + ">" + esc(op[1]) + "</option>").join("") + "</select>"
      : fd.type === "textarea" ? '<textarea rows="3" data-ui="' + esc(fd.id) + '">' + esc(fd.value || "") + "</textarea>"
      : '<input type="' + esc(fd.type || "text") + '" data-ui="' + esc(fd.id) + '" value="' + esc(fd.value == null ? "" : fd.value) + '"' + (fd.placeholder ? ' placeholder="' + esc(fd.placeholder) + '"' : "") + ">") +
    (fd.hint ? '<span class="hint">' + esc(fd.hint) + "</span>" : "") + "</label>").join("") +
    (o.confirmWord ? "<label>Type <b>" + esc(o.confirmWord) + '</b> to go ahead<input type="text" data-ui="__confirm" autocomplete="off" inputmode="numeric"></label>' : "") +
    '<div class="err" id="uiErr" role="alert"></div>';
  $("uiOk").textContent = o.ok || "OK";
  $("uiOk").className = o.danger ? "dangerbtn" : "";
  $("uiCancel").hidden = o.cancel === false;
  $("uiCancel").textContent = o.cancelLabel || "Cancel";
  $("uiDialog").hidden = false;
  const first = $("uiBody").querySelector("input:not([readonly]), select, textarea");
  // Paid or risky: the keyboard starts on Cancel, so a stray Enter never spends or deletes.
  (first || (o.cancel !== false && (o.danger || o.paid) ? $("uiCancel") : $("uiOk"))).focus();
  return new Promise((res) => { uiResolve = res; });
}
$("uiOk").onclick = () => {
  const vals = {};
  $("uiBody").querySelectorAll("[data-ui]").forEach((el) => { vals[el.dataset.ui] = el.value; });
  const plain = (v) => String(v || "").replace(/[ ,]/g, "").toLowerCase();
  if (uiOpts.confirmWord && plain(vals.__confirm) !== plain(uiOpts.confirmWord)) { $("uiErr").textContent = "Type " + uiOpts.confirmWord + " to go ahead."; return; }
  if (uiOpts.validate) { const m = uiOpts.validate(vals); if (m) { $("uiErr").textContent = m; return; } }
  uiClose((uiOpts.fields || []).length ? vals : true);
};
const uiCancel = () => uiClose((uiOpts.fields || []).length ? null : false);
$("uiCancel").onclick = uiCancel; $("uiX").onclick = uiCancel;
$("uiBody").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); $("uiOk").click(); } });
/** Yes / no. */
const ask = (title, text, ok, opts) => uiForm({ title, text, ok: ok || "OK", ...(opts || {}) }).then(Boolean);
/** One line of text, or null. */
const askText = (title, label, value, opts) => uiForm({ title, fields: [{ id: "v", label, value }], ok: "Save", ...(opts || {}) }).then((v) => (v && v.v.trim()) || null);
/** Something to copy (a link, a password, a key) with a Copy button. */
function showCopy(title, value, text) {
  const p = uiForm({ title, cancel: false, ok: "Done",
    html: (text ? '<p class="uitext">' + esc(text) + "</p>" : "") + '<div class="copyrow"><input type="text" readonly id="uiCopyVal" value="' + esc(value) + '"><button type="button" id="uiCopyBtn">Copy</button></div>' });
  $("uiCopyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(value); $("uiCopyBtn").textContent = "Copied ✓"; }
    catch (e) { $("uiCopyVal").select(); $("uiCopyBtn").textContent = "Press Ctrl+C"; }
  };
  $("uiCopyBtn").focus();
  return p;
}
// Every pop-up window closes with Escape or a click outside it (the business window asks first if a note isn't saved).
async function closeModal(box) {
  if (!box || box.hidden) return;
  if (box.id === "uiDialog") return uiCancel();
  if (box.id === "catPicker") return closePicker();
  if (box.id === "leadDialog" && $("ldNote").value.trim() && !(await ask("Close without saving the note?", "The note you typed hasn’t been added yet.", "Close anyway", { danger: true }))) return;
  box.hidden = true;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal-backdrop")].filter((b) => !b.hidden);
  if (open.length) closeModal(open[open.length - 1]);
});
document.addEventListener("mousedown", (e) => { if (e.target.classList && e.target.classList.contains("modal-backdrop")) closeModal(e.target); });
const PHONE_LABELS = { mobile: "Mobile", landline: "Landline", toll_free: "Toll-free", voip: "Internet (VoIP)", unknown: "Couldn't tell", unchecked: "Not checked yet", no_phone: "No phone" };
const STATUS_LABELS = { operational: "Open", temporarily_closed: "Temporarily closed", permanently_closed: "Permanently closed" };
const SITE_PROBLEM_LABELS = {
  no_booking: "No online booking", no_form: "No contact form", no_tracking: "No Meta pixel or Google tag", no_meta_pixel: "No Meta pixel",
  no_https: "Not secure (no https)", not_mobile: "Not mobile friendly", outdated: "Looks outdated (© 3+ years old)", no_chat: "No chat widget",
  slow: "Slow on phones (speed under 50)",
};
/** Score pill: the overall number, coloured (low = opportunity), with the notes on hover. */
function scoreCell(l) {
  if (l.presence_score == null) return '<span class="muted" title="Scored once the website is checked or Google details arrive">–</span>';
  let n = {}; try { n = JSON.parse(l.score_notes || "{}"); } catch (e) { n = {}; }
  const tip = [l.gbp_score != null ? "Google profile " + l.gbp_score + "/100: " + (n.gbpComment || "") : "Google profile: not known (free data)",
    l.website_score != null ? "Website " + l.website_score + "/100: " + (n.websiteComment || "") : "Website: not checked yet",
    (n.suggestions || []).length ? "What to fix: " + n.suggestions.join("; ") : ""].filter(Boolean).join(" | ");
  const cls = l.presence_score >= 60 ? "ok" : l.presence_score >= 40 ? "warn" : "bad";
  // Low score = weak online presence = more you can sell them.
  return '<button type="button" class="pill scorebtn ' + cls + '" data-lead="' + esc(l.id) + '" title="' + esc(tip + " | Click for the details") + '">' + esc(l.presence_score) + "</button>";
}
/** What the website check found, in a few words under the website link. */
function siteFacts(l) {
  const KIND = { personal: "a person", role: "shared inbox", freemail: "free mail" };
  const CHECK = { ok: '<span class="ok-text" title="Verified: safe to send">✓ valid</span>', catch_all: '<span class="muted" title="The domain accepts every address, so it can’t be confirmed">⚠ risky</span>',
    unknown: '<span class="muted" title="The mail server didn’t answer clearly">⚠ unknown</span>', invalid: '<span class="bad-text" title="Would bounce: left out of downloads">✗ bounces</span>',
    disposable: '<span class="bad-text" title="A throwaway address: left out of downloads">✗ throwaway</span>', queued: '<span class="muted">checking…</span>' };
  const emails = l.emails ? '<div class="cellnote" title="' + esc(l.emails) + '">✉ ' + esc(l.emails.split(", ")[0]) + (l.email_kind ? ' <span class="muted">(' + esc(KIND[l.email_kind] || "") + ")</span>" : "") + (l.email_check ? " " + (CHECK[l.email_check] || "") : "") +
    (l.emails.includes(",") ? " +" + (l.emails.split(", ").length - 1) : "") + "</div>" : "";
  if (!l.website_domain) return emails;
  if (!l.audit) return (l.website_audit_status === "queued" || l.website_audit_status === "checking" ? '<div class="muted cellnote">checking soon…</div>' : "") + emails;
  let a = {}; try { a = JSON.parse(l.audit); } catch (e) { return emails; }
  if (!a.reachable) return '<div><span class="pill bad" title="' + esc(a.error || "") + '">doesn’t load</span></div>' + emails;
  if (a.error && a.error.startsWith("blocked:")) return '<div class="muted cellnote" title="' + esc(a.error.slice(8)) + '">couldn’t read it</div>' + emails;
  const miss = [];
  if (!a.booking) miss.push("no booking");
  if (!a.form) miss.push("no form");
  if (!a.pixel && !a.gtag) miss.push("no tracking");
  if (!a.https) miss.push("no https");
  if (!a.mobile) miss.push("not mobile");
  if (a.year && a.year <= new Date().getFullYear() - 3) miss.push("© " + a.year);
  if (a.psi != null && a.psi < 50) miss.push("slow (" + a.psi + ")");
  const built = a.builder && a.builder !== "other" ? BUILDER_LABELS[a.builder] || a.builder : "";
  const adSigns = [a.gads ? "Google Ads" : "", a.bing ? "Microsoft Ads" : "", a.calls ? "call tracking (" + a.calls + ")" : ""].filter(Boolean);
  const ads = adSigns.length ? '<div class="cellnote"><span class="pill warn" title="Advertising tags on the website: they spend money on ads">💰 ' + esc(adSigns.join(", ")) + '</span></div>' : "";
  // Email / domain setup: only what's worth saying.
  const soon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const setup = [a.mail === "No email on this domain" ? '<span class="bad-text">no email on their domain</span>' : a.mail ? "email: " + esc(a.mail) : "",
    a.since ? (a.since >= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) ? '<span class="ok-text">new domain (' + esc(a.since.slice(0, 7)) + ")</span>" : "domain since " + esc(a.since.slice(0, 4))) : "",
    a.cert && a.cert <= soon ? '<span class="bad-text">certificate ends ' + esc(a.cert) + "</span>" : ""].filter(Boolean);
  const setupLine = setup.length ? '<div class="cellnote muted">' + setup.join(" · ") + "</div>" : "";
  return '<div class="cellnote"><span class="muted">' + esc(built) + (built && miss.length ? " · " : "") + "</span>" +
    (miss.length ? '<span class="bad-text">' + esc(miss.slice(0, 3).join(", ")) + (miss.length > 3 ? " +" + (miss.length - 3) : "") + "</span>" : '<span class="ok-text">all basics in place</span>') + "</div>" + ads + setupLine + emails;
}
const BUILDER_LABELS = { wordpress: "WordPress", wix: "Wix", squarespace: "Squarespace", shopify: "Shopify", godaddy: "GoDaddy", weebly: "Weebly",
  duda: "Duda", webflow: "Webflow", highlevel: "HighLevel (GHL)", other: "Custom / other" };
const PULL_LABELS = { pending: "Starting", scraping: "Collecting", ingesting: "Saving", enriching: "Checking", done: "Ready", failed: "Failed" };
const REVIEW_LABELS = { none: "No reviews", "1-10": "1 – 10", "11-100": "11 – 100", "101-1000": "101 – 1,000", "1001-10000": "1,001 – 10,000", "10001+": "More than 10,000" };

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
    if (cfg.hint) html += '<div class="hint" style="padding:0 2px 6px">' + esc(cfg.hint) + "</div>";
    if (!cfg.single) html += '<div class="bulk">' + (cfg.noBulk ? "<span></span>" : '<button type="button" class="link" data-act="all">Select all' + (filterText ? " shown" : "") + "</button>") + '<button type="button" class="link" data-act="clear">Clear</button></div>';
    html += '<div class="opts">';
    if (!shown.length) html += '<div class="empty">' + esc(cfg.emptyText || "Nothing here yet") + "</div>";
    let group = null;
    for (const o of shown) {
      if (o.group && o.group !== group) {
        group = o.group;
        html += '<div class="grp"><span>' + esc(group) + "</span>" + (cfg.single || cfg.noBulk ? "" : '<button type="button" class="link" data-grp="' + esc(group) + '">Select all</button>') + "</div>";
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
  chip.setAttribute("aria-haspopup", "true");
  chip.setAttribute("aria-expanded", "false");
  chip.onclick = () => {
    const open = !el.classList.contains("open");
    dropdowns.forEach((d) => { d.el.classList.remove("open"); d.el.querySelector(".chip").setAttribute("aria-expanded", "false"); });
    if (open) {
      filterText = ""; dd.renderPop(); el.classList.add("open"); chip.setAttribute("aria-expanded", "true");
      const s = pop.querySelector(".search"); if (s) s.focus();
      // e.g. filter counts are only worked out when a dropdown is opened.
      if (cfg.beforeOpen) cfg.beforeOpen().then((changed) => { if (changed && el.classList.contains("open") && !filterText) dd.renderPop(); }).catch(() => {});
    }
  };
  dd.set = (values) => { dd.selected = new Set(values); dd.renderChip(); };
  // New counts/options: update the chip; an open list is left alone so typing isn't wiped.
  dd.refresh = () => { dd.renderChip(); };
  dd.renderChip();
  dropdowns.push(dd);
  return dd;
}
document.addEventListener("click", (e) => { if (!e.target.closest(".dd")) dropdowns.forEach((d) => d.el.classList.remove("open")); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") dropdowns.forEach((d) => d.el.classList.remove("open")); });

// ---------------------------------------------------------------------------
// Search row: What (types of business) and Where (states / cities), typed with suggestions.
// On "Find leads" they say what to collect; on "Database" they set the type / state / city filters.
// ---------------------------------------------------------------------------
let geo = { countries: [], regions: [] }, tree = null;
/** Picked places, each { key, kind: "region" | "city", country, region, city, label }. */
let places = [];

const whereCountry = dropdown($("dd-country"), {
  label: "Countries", allLabel: "none chosen",
  // United States first, then alphabetical.
  options: () => geo.countries.map((c) => ({ value: c.code, label: c.name, group: c.code === "US" ? "Most used" : "All countries" }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Most used" ? -1 : 1)),
  onChange: () => { loadRegions().then(renderWhat).catch((err) => setFindMsg(err.message, true)); },
});
// ---------------------------------------------------------------------------
// "What" picker: groups -> sectors -> popular tiles (+ "show all"), one search box, picks as tags.
// ---------------------------------------------------------------------------
const what = { selected: new Set(), refresh: () => renderWhat(), renderChip: () => renderWhat() };
const picker = { sector: "Home Services", search: "", showAll: false };
const sectorOf = (name) => tree && tree.industries.find((i) => i.industry === name);
const inSector = (name) => { const s = sectorOf(name); return s ? s.categories : []; };
let acWhat = null, acWhere = null; // the two type-ahead boxes (made further down)

/** Something changed in the search row: redraw it, and grey out an answer that no longer matches. */
function renderWhat() {
  if (acWhat) { acWhat.render(); acWhere.render(); }
  if (!$("catPicker").hidden) renderPicker();
  updateFindLabel();
  markPlanStale();
}
function setFindMsg(text, bad) { $("findMsg").className = bad ? "hint err" : "hint"; $("findMsg").textContent = text || ""; }
// One search = one type in one place; the server takes at most MAX_SEARCHES at once.
const MAX_SEARCHES = 40;
function comboCount() { return what.selected.size * Math.max(1, locationsFromBuilder().length); }
function comboText() {
  const t = what.selected.size, pl = Math.max(1, locationsFromBuilder().length);
  return t + " type" + (t === 1 ? "" : "s") + " × " + pl + " place" + (pl === 1 ? "" : "s") + " = " + (t * pl) + " search" + (t * pl === 1 ? "" : "es") +
    (t * pl > MAX_SEARCHES ? " (the most at once is " + MAX_SEARCHES + ")" : "");
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
      (hits.length ? '<button type="button" class="pill-btn" data-act="add-hits">Select all ' + Math.min(hits.length, 400) + "</button>" : "") + "</div>";
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
          '<label><input type="checkbox" data-cat="' + esc(c.name) + '"' + (sel.has(c.name) ? " checked" : "") + "> <span>" + esc(c.name) + (c.top100 ? ' <span style="color:var(--warn)">★</span>' : "") + "</span></label>").join("") + "</div>";
      }
    }
  }

  const chosen = [...sel];
  const foot = chosen.length
    ? chosen.slice(0, 30).map((c) => '<span class="tag">' + esc(c) + ' <button type="button" data-unpick="' + esc(c) + '" aria-label="Remove">×</button></span>').join("") +
      (chosen.length > 30 ? '<span class="muted">+' + (chosen.length - 30) + " more</span>" : "")
    : '<span class="hint">Nothing picked yet. Click a tile to pick it. ★ marks the Top 100 types.</span>';
  const comboNote = chosen.length ? '<span class="hint' + (comboCount() > MAX_SEARCHES ? " err" : "") + '" style="white-space:nowrap">' + esc(comboText()) + "</span>" : "";

  const keepScroll = box.querySelector(".main")?.scrollTop || 0, keepSide = box.querySelector(".side")?.scrollTop || 0;
  box.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Choose types of business">' +
    '<div class="modal-head"><div class="title"><h2>Choose types of business</h2><button type="button" class="x" data-act="close-picker" aria-label="Close">×</button></div>' +
    '<div class="searchrow"><div class="searchbox"><input type="text" id="pickerSearch" placeholder="Search ' + total.toLocaleString() + ' types, e.g. roofing, dentist, pizza" value="' + esc(picker.search) + '"></div>' +
    '<button type="button" class="pill-btn" data-act="top100" title="The 100 types most worth targeting: from the sectors you picked from, or all">★ Add Top 100</button></div></div>' +
    '<div class="modal-body"><div class="side">' + side + '</div><div class="main">' + main + "</div></div>" +
    '<div class="modal-foot"><div class="chosen">' + foot + "</div>" +
    comboNote + (chosen.length ? '<button type="button" class="link small" data-act="clear-what">Clear all</button>' : "") +
    '<button type="button" class="done" data-act="close-picker">Done' + (chosen.length ? " · " + chosen.length + " picked" : "") + "</button></div></div>";
  const m = box.querySelector(".main"); if (m) m.scrollTop = keepScroll;
  const s = box.querySelector(".side"); if (s) s.scrollTop = keepSide;
  const input = $("pickerSearch");
  input.oninput = () => { picker.search = input.value; renderPicker(); const i = $("pickerSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
}
function openPicker() { $("catPicker").hidden = false; document.body.style.overflow = "hidden"; renderPicker(); $("pickerSearch") && $("pickerSearch").focus(); }
function closePicker() { $("catPicker").hidden = true; document.body.style.overflow = ""; $("whatInput").focus(); }
$("browseTypes").onclick = openPicker;
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cat],[data-sector],[data-act],[data-unpick]");
  if (!t || !t.closest("#catPicker")) return;
  const sel = what.selected;
  if (t.dataset.unpick) sel.delete(t.dataset.unpick);
  else if (t.dataset.sector) { picker.sector = t.dataset.sector; picker.search = ""; picker.showAll = false; }
  else if (t.dataset.cat && t.tagName === "BUTTON") sel.has(t.dataset.cat) ? sel.delete(t.dataset.cat) : sel.add(t.dataset.cat);
  else if (t.dataset.cat) t.checked ? sel.add(t.dataset.cat) : sel.delete(t.dataset.cat);
  else switch (t.dataset.act) {
    case "sector-all": inSector(picker.sector).forEach((c) => sel.add(c.name)); break;
    case "sector-none": inSector(picker.sector).forEach((c) => sel.delete(c.name)); break;
    case "show-all": picker.showAll = true; break;
    case "add-hits": { const q = picker.search.trim().toLowerCase(); tree.industries.flatMap((i) => i.categories).filter((c) => wordMatch(c.name, q)).slice(0, 400).forEach((c) => sel.add(c.name)); break; }
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
  onChange: (sel) => { if (sel.size) $("checkPhones").checked = true; $("checkPhones").disabled = sel.size > 0; markPlanStale(); },
});
function countryLabel(code) { const c = geo.countries.find((x) => x.code === code); return c ? c.name : code; }

/** States / provinces of the picked countries (for Where suggestions); places in other countries are dropped. */
async function loadRegions() {
  const countries = [...whereCountry.selected];
  geo.regions = countries.length ? await api("/api/geo/regions?" + countries.map((c) => "country=" + encodeURIComponent(c)).join("&")) : [];
  places = places.filter((p) => whereCountry.selected.has(p.country));
}
const regionPlace = (r) => ({ key: "r|" + r.country + "|" + r.code, kind: "region", country: r.country, region: r.code,
  label: r.name + (whereCountry.selected.size > 1 ? ", " + countryLabel(r.country) : "") });
const cityPlace = (c) => ({ key: "c|" + c.country + "|" + (c.region || "") + "|" + c.name, kind: "city", country: c.country, region: c.region || "", city: c.name,
  label: c.name + ", " + (c.country === "US" ? c.region : c.region_name || countryLabel(c.country)) });
/** A state code ("FL") as its name ("Florida (FL)") when we know it. */
function stateName(code) { const r = geo.regions.find((x) => x.country === "US" && x.code === code); return r ? r.name + " (" + code + ")" : code; }

/** Every picked place (a state or a city); with none, whole countries (outside the US). */
function locationsFromBuilder() {
  if (places.length) return places.map((p) => (p.kind === "city" ? { country: p.country, region: p.region, city: p.city } : { country: p.country, region: p.region }));
  return [...whereCountry.selected].map((country) => ({ country }));
}

// Type-ahead box with chips. Arrow keys move through the suggestions, Enter picks one (or searches
// when the box is empty), Escape closes the list, Backspace in an empty box removes the last chip.
// o: { box, input, list, placeholder, suggest(q) -> items, pick(item), chips() -> [[key, label]], unpick(key), onEnter(), onNoMatch(q), onMore(), delay }
// An item is { label, sub, ... } or { label, action } (a command, e.g. "Browse all types").
function typeahead(o) {
  let items = [], active = -1, seq = 0, timer = null;
  const ta = {};
  const close = () => { o.list.hidden = true; o.input.setAttribute("aria-expanded", "false"); o.input.removeAttribute("aria-activedescendant"); active = -1; };
  const draw = () => {
    o.list.innerHTML = items.map((it, i) => '<div class="acopt' + (i === active ? " on" : "") + (it.action ? " acact" : "") + '" role="option" id="' + o.list.id + "-" + i +
      '" data-i="' + i + '" aria-selected="' + (i === active) + '"><span>' + esc(it.label) + "</span>" + (it.sub ? '<span class="acsub">' + esc(it.sub) + "</span>" : "") + "</div>").join("");
    o.list.hidden = !items.length;
    o.input.setAttribute("aria-expanded", String(!!items.length));
    const el = active >= 0 ? $(o.list.id + "-" + active) : null;
    if (el) { o.input.setAttribute("aria-activedescendant", el.id); el.scrollIntoView({ block: "nearest" }); } else o.input.removeAttribute("aria-activedescendant");
  };
  /** Suggestions for what's typed; null when a newer keystroke overtook this one. */
  ta.update = async () => {
    const q = o.input.value.trim(), my = ++seq;
    if (!q) { items = []; close(); return []; }
    let found = [];
    try { found = await o.suggest(q); } catch (e) { found = []; }
    if (my !== seq) return null;
    items = found || [];
    active = items.length ? 0 : -1;
    draw();
    return items;
  };
  const choose = (it) => {
    if (!it) return;
    o.input.value = ""; items = []; close();
    if (it.action) { it.action(); return; }
    o.pick(it); ta.render(); o.input.focus();
  };
  /** Typed but not picked (e.g. Search pressed): take the best suggestion. */
  ta.pickTop = async () => {
    clearTimeout(timer);
    const q = o.input.value.trim();
    const list = await ta.update();
    const it = (list || []).find((x) => !x.action);
    if (it) { choose(it); return true; }
    if (list) { close(); if (o.onNoMatch) o.onNoMatch(q); }
    return false;
  };
  ta.render = () => {
    const chips = o.chips(), MAX = 6;
    o.box.querySelectorAll(".tag").forEach((t) => t.remove());
    o.input.insertAdjacentHTML("beforebegin", chips.slice(0, MAX).map(([k, label]) => '<span class="tag">' + esc(label) +
      ' <button type="button" data-chip="' + esc(k) + '" aria-label="Remove ' + esc(label) + '">×</button></span>').join("") +
      (chips.length > MAX ? '<span class="tag more" data-chip-more title="See them all">+' + (chips.length - MAX) + " more</span>" : ""));
    o.input.placeholder = chips.length ? "add more…" : o.placeholder();
  };
  ta.reset = () => { clearTimeout(timer); seq++; o.input.value = ""; items = []; close(); };
  o.input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(ta.update, o.delay || 0); });
  o.input.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (o.list.hidden) { await ta.update(); return; }
      const n = items.length; if (!n) return;
      active = e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n;
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!o.list.hidden && active >= 0) choose(items[active]);
      else if (o.input.value.trim()) { if (await ta.pickTop()) o.onEnter(); }
      else o.onEnter();
    } else if (e.key === "Escape") {
      if (!o.list.hidden) { e.stopPropagation(); close(); }
    } else if (e.key === "Backspace" && !o.input.value) {
      const c = o.chips(); if (c.length) { o.unpick(c[c.length - 1][0]); ta.render(); }
    } else if (e.key === "Tab") close();
  });
  o.input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== o.input) close(); }, 150));
  o.input.addEventListener("focus", () => { if (o.input.value.trim()) ta.update(); });
  // mousedown (not click) so the box keeps the keyboard focus.
  o.list.addEventListener("mousedown", (e) => { const el = e.target.closest("[data-i]"); if (!el) return; e.preventDefault(); choose(items[Number(el.dataset.i)]); });
  o.box.addEventListener("click", (e) => {
    const x = e.target.closest("[data-chip]");
    if (x) { o.unpick(x.dataset.chip); ta.render(); o.input.focus(); return; }
    if (e.target.closest("[data-chip-more]")) { if (o.onMore) o.onMore(); return; }
    o.input.focus();
  });
  return ta;
}
const isDb = () => currentTab === "database";
let allTypes = null; // every type of business, flat: [{ name, top, sector }]
/** Types of business whose words start with what's typed: exact and Top 100 first. */
function typeHits(q, limit) {
  if (!tree) return [];
  if (!allTypes) {
    const seen = new Set();
    allTypes = tree.industries.flatMap((i) => i.categories.map((c) => ({ name: c.name, top: !!c.top100, sector: i.industry })))
      .filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()));
  }
  const ql = q.toLowerCase();
  const rank = (c) => (c.name.toLowerCase() === ql ? 0 : c.name.toLowerCase().startsWith(ql) ? 2 : 4) + (c.top ? 0 : 1);
  return allTypes.filter((c) => !what.selected.has(c.name) && wordMatch(c.name, q))
    .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit).map((c) => ({ value: c.name, label: c.name, sub: c.sector }));
}
/** Filter counts (type / state / city in the database), loaded once per change of filters. */
async function freshFacets() { if (!facets || facetsStale) await loadFacets(); return facets || {}; }
/** "Tampa, fl" -> name "Tampa" + region "fl" (to tell the Springfields apart). */
function splitPlace(q) { const [name, reg] = q.split(",").map((s) => s.trim()); return { name: name || "", reg: (reg || "").toLowerCase() }; }

acWhat = typeahead({
  box: $("whatBox"), input: $("whatInput"), list: $("whatList"),
  placeholder: () => (isDb() ? "Type of business" : "Plumber, dentist, roofer…"),
  suggest: async (q) => {
    if (isDb()) {
      const fc = await freshFacets();
      return (fc.categories || []).filter((c) => c.value && !f.category.selected.has(c.value) && wordMatch(c.value, q)).slice(0, 8)
        .map((c) => ({ value: c.value, label: c.value, sub: num(c.n) }));
    }
    const hits = typeHits(q, 8);
    return hits.length ? hits : [{ label: "No match. Browse all types", action: openPicker }];
  },
  pick: (it) => {
    if (isDb()) { f.category.selected.add(it.value); f.category.renderChip(); reload(); }
    else { what.selected.add(it.value); renderWhat(); }
  },
  chips: () => [...(isDb() ? f.category.selected : what.selected)].map((v) => [v, v]),
  unpick: (k) => {
    if (isDb()) { f.category.selected.delete(k); f.category.renderChip(); reload(); }
    else { what.selected.delete(k); renderWhat(); }
  },
  onMore: () => { if (isDb()) { $("moreFilters").open = true; setTimeout(() => f.category.el.querySelector(".chip").click(), 0); } else openPicker(); },
  onEnter: () => runFind(),
  onNoMatch: (q) => setFindMsg("No type of business matches “" + q + "”." + (isDb() ? "" : " Try Browse all types."), true),
});
acWhere = typeahead({
  box: $("whereBox"), input: $("whereInput"), list: $("whereList"), delay: 150,
  placeholder: () => "State or city",
  suggest: async (q) => {
    const { name, reg } = splitPlace(q);
    const ql = name.toLowerCase();
    if (isDb()) {
      const fc = await freshFacets();
      const states = (fc.states || []).filter((s) => s.value && !f.state.selected.has(s.value) && !reg && (s.value.toLowerCase() === ql || wordMatch(stateName(s.value), name)))
        .slice(0, 4).map((s) => ({ kind: "state", value: s.value, label: stateName(s.value), sub: num(s.n) }));
      const cities = (fc.cities || []).filter((c) => c.city && wordMatch(c.city, name) && !f.city.selected.has(c.city + "|" + (c.state || "")) && (!reg || (c.state || "").toLowerCase().startsWith(reg)))
        .sort((a, b) => b.n - a.n).slice(0, 8).map((c) => ({ kind: "city", value: c.city + "|" + (c.state || ""), label: c.city + (c.state ? ", " + c.state : ""), sub: num(c.n) }));
      return [...states, ...cities];
    }
    if (!whereCountry.selected.size) return [{ label: "Choose a country first (More options)", action: () => toggleMore(true) }];
    const taken = new Set(places.map((p) => p.key));
    const states = reg ? [] : geo.regions.filter((r) => (r.country === "US" && r.code.toLowerCase() === ql) || wordMatch(r.name, name))
      .map(regionPlace).filter((p) => !taken.has(p.key)).slice(0, 4).map((p) => ({ place: p, label: p.label, sub: "whole state" }));
    const p = new URLSearchParams();
    whereCountry.selected.forEach((c) => p.append("country", c));
    p.set("q", name); p.set("limit", reg ? "40" : "8");
    const found = name ? await api("/api/geo/cities?" + p) : [];
    const cities = found.filter((c) => !reg || String(c.region || "").toLowerCase().startsWith(reg) || String(c.region_name || "").toLowerCase().startsWith(reg))
      .map(cityPlace).filter((x) => !taken.has(x.key)).slice(0, 8).map((x) => ({ place: x, label: x.label, sub: "city" }));
    return [...states, ...cities];
  },
  pick: (it) => {
    if (isDb()) { (it.kind === "state" ? f.state : f.city).selected.add(it.value); f.state.renderChip(); f.city.renderChip(); reload(); }
    else { places.push(it.place); renderWhat(); }
  },
  chips: () => (isDb() ? [...[...f.state.selected].map((v) => ["s:" + v, stateName(v)]), ...[...f.city.selected].map((v) => ["c:" + v, v.replace("|", ", ")])]
    : places.map((p) => [p.key, p.label])),
  unpick: (k) => {
    if (isDb()) { (k.startsWith("s:") ? f.state : f.city).selected.delete(k.slice(2)); f.state.renderChip(); f.city.renderChip(); reload(); }
    else { places = places.filter((p) => p.key !== k); renderWhat(); }
  },
  onMore: () => { if (isDb()) { $("moreFilters").open = true; setTimeout(() => f.city.el.querySelector(".chip").click(), 0); } },
  onEnter: () => runFind(),
  onNoMatch: (q) => setFindMsg("No place matches “" + q + "”." + (isDb() ? " Nothing collected there yet?" : " Small towns: pick the state."), true),
});
function toggleMore(open) {
  const show = open == null ? $("moreOptions").hidden : open;
  $("moreOptions").hidden = !show; $("moreBtn").setAttribute("aria-expanded", String(show));
  $("moreBtn").textContent = show ? "Fewer options ▴" : "More options ▾";
}
$("moreBtn").onclick = () => toggleMore();
// Example searches (when nothing is shown yet): fill the search row, ready to press Search.
async function fillExample(spec) {
  const [typeQ, city, st] = spec.split("|");
  if (!tree) return;
  if (!whereCountry.selected.has("US")) { whereCountry.set([...whereCountry.selected, "US"]); await loadRegions(); }
  what.selected.clear();
  const hit = typeHits(typeQ, 1)[0];
  if (hit) what.selected.add(hit.value);
  let place = null;
  if (city) { const r = await api("/api/geo/cities?region=US." + st + "&q=" + encodeURIComponent(city) + "&limit=1").catch(() => []); if (r[0]) place = cityPlace(r[0]); }
  else { const r = geo.regions.find((x) => x.country === "US" && x.code === st); if (r) place = regionPlace(r); }
  places = place ? [place] : [];
  renderWhat();
  $("findBtn").focus();
}
$("emptyState").addEventListener("click", (e) => { const b = e.target.closest("[data-example]"); if (b) fillExample(b.dataset.example).catch((err) => setFindMsg(err.message, true)); });

// ---------------------------------------------------------------------------
// Find leads: plan (+ counts) -> (maybe) pull -> show results
// ---------------------------------------------------------------------------
let lastRequest = null;
const BIG = 100000;
const RUNNING = ["pending", "scraping", "ingesting"];
/** free (open map data) or google (Google Maps, paid). */
function dataSource() { const r = document.querySelector('input[name="source"]:checked'); return r ? r.value : "free"; }
function applySource() {
  const free = dataSource() === "free";
  document.querySelectorAll(".seg label").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
  ["howManyLine", "countLine"].forEach((id) => { $(id).hidden = free; });
  updateFindLabel();
  markPlanStale();
}
document.querySelectorAll('input[name="source"]').forEach((r) => r.addEventListener("change", applySource));
/** What the search row is asking for right now. */
function currentRequest() {
  return {
    source: dataSource(),
    categories: [...what.selected], locations: locationsFromBuilder(), maxResults: Number($("maxResults").value),
    withCounts: $("withCounts").checked, countWebsite: $("countWebsite").value || null, countVerifiedOnly: $("countVerified").checked,
    countWithPhone: $("countPhone").checked,
    checkPhones: $("checkPhones").checked || phoneTypesWanted.selected.size > 0,
    radiusMiles: Number($("radiusMiles").value) || null,
  };
}
let planStarted = false; // Collect (or "Show them") was pressed for the answer on screen
/** The search changed after Search was pressed: grey the answer out until it's searched again. */
function markPlanStale() {
  if (!lastRequest || planStarted || $("plan").hidden || !$("staleNote")) return;
  const stale = JSON.stringify(currentRequest()) !== JSON.stringify(lastRequest);
  $("staleNote").hidden = !stale;
  $("plan").querySelectorAll(".actions button").forEach((b) => b.disabled = stale || b.dataset.off === "1");
}
["maxResults", "withCounts", "countWebsite", "countPhone", "countVerified", "checkPhones", "radiusMiles"].forEach((id) => $(id).addEventListener("change", markPlanStale));

let lastCountFilters = {};
function rememberFind() {
  mem.set("lastFind", { source: dataSource(), countries: [...whereCountry.selected], places, cats: [...what.selected], maxResults: $("maxResults").value, radius: $("radiusMiles").value });
}
async function restoreLastFind() {
  const last = mem.get("lastFind", null);
  const known = (c) => geo.countries.some((x) => x.code === c);
  const countries = last && last.countries && last.countries.length ? last.countries.filter(known) : known("US") ? ["US"] : [];
  if (last && last.source) { const r = document.querySelector('input[name="source"][value="' + last.source + '"]'); if (r) { r.checked = true; applySource(); } }
  whereCountry.set(countries);
  await loadRegions();
  if (!last) return;
  const inCountry = (p) => p && p.key && p.label && whereCountry.selected.has(p.country);
  if (Array.isArray(last.places)) places = last.places.filter(inCountry);
  else {
    // Saved by the older page: "US|FL|Orlando" cities, else "US.FL" states.
    const cities = (last.cities || []).map((k) => { const [country, region, name] = String(k).split("|"); const r = geo.regions.find((x) => x.country === country && x.code === region); return cityPlace({ country, region, name, region_name: r ? r.name : region }); });
    const states = (last.regions || []).map((k) => { const [country, code] = String(k).split("."); const r = geo.regions.find((x) => x.country === country && x.code === code); return r ? regionPlace(r) : null; });
    places = (cities.length ? cities : states).filter(inCountry);
  }
  (last.cats || []).forEach((c) => what.selected.add(c));
  if (last.maxResults) $("maxResults").value = String(last.maxResults);
  $("radiusMiles").value = String(last.radius || "");
  renderWhat();
  if (what.selected.size) setFindMsg("Your last search is filled in.");
}
/** A short note under the row, only when it matters: too many searches, or what counting on Google costs. */
function updateFindLabel() {
  if (isDb()) return;
  const n = comboCount();
  if (what.selected.size && n > MAX_SEARCHES) return setFindMsg(comboText() + ". Pick fewer types or places.", true);
  const counting = dataSource() === "google" && $("withCounts").checked && what.selected.size > 0;
  setFindMsg(counting ? "Counting on Google first: about " + money(n * 0.01) + "." : "");
}
$("withCounts").addEventListener("change", updateFindLabel);
/** Search: on Find leads, show what we have and what collecting would cost; on Database, filter. */
async function runFind() {
  // Typed but not picked yet: take the best match (like a search engine does).
  if ($("whatInput").value.trim() && !(await acWhat.pickTop())) return;
  if ($("whereInput").value.trim() && !(await acWhere.pickTop())) return;
  if (isDb()) { setFindMsg(""); reload(); return; }
  const req = currentRequest();
  rememberFind();
  const msg = setFindMsg;
  if (!req.categories.length) { msg("Type a business type in What.", true); return $("whatInput").focus(); }
  if (!req.locations.length) { msg("Type a state or city in Where.", true); return $("whereInput").focus(); }
  if (req.locations.some((l) => l.country === "US" && !l.region && !l.city)) { msg("Add a state or city in Where (all of the US is too big).", true); return $("whereInput").focus(); }
  if (comboCount() > MAX_SEARCHES) return msg(comboText() + ". Pick fewer types or places.", true);
  lastPhoneTypes = [...phoneTypesWanted.selected];
  lastCountFilters = { website: req.countWebsite, phone: req.countWithPhone, verified: req.countVerifiedOnly };
  msg(req.source === "google" && req.withCounts ? "Counting on Google…" : "Checking…");
  $("findBtn").disabled = true;
  try {
    const plan = await postJson("/api/find", { ...req, mode: "plan" });
    lastRequest = req; planStarted = false; startedIds = [];
    msg("");
    renderProgress();
    showPlan(plan);
    // Everything is already here and nothing needs paying for: show the list straight away.
    if (!plan.needPull && !plan.blocked && !req.checkPhones && plan.alreadyHave) showResults(plan);
  } catch (err) { msg(err.message, true); }
  finally { $("findBtn").disabled = false; }
}
$("findBtn").onclick = () => { runFind().catch((err) => setFindMsg(err.message, true)); };

function where(c) { return c.place ? c.place.label : c.city ? c.city + ", " + c.state : "all of " + c.state; }
function planLabel(plan) {
  const cats = [...new Set(plan.combinations.map((c) => c.category))], locs = [...new Set(plan.combinations.map(where))];
  return (cats.length > 2 ? cats.length + " types" : cats.join(", ")) + " in " + (locs.length > 2 ? locs.length + " places" : locs.join(", "));
}
const num = (n) => Number(n || 0).toLocaleString();
// The answer to a search: one line for what you already have, one for what isn't collected yet,
// each with one button; problems as one short line each with their one-click fix; the rest under Details.
let startedIds = [];
const expectedById = {};
function names(list, max) {
  const labels = list.map((c) => c.category + " in " + where(c));
  return labels.length > max ? labels.slice(0, max).join(", ") + " and " + (labels.length - max) + " more" : labels.join(", ");
}
const plural = (w, n) => n === 1 ? w : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + "ies" : /(s|x|z|ch|sh)$/i.test(w) ? w + "es" : w + "s";
const lowerFirst = (s) => /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
/** "plumbers", or "businesses" when there are several types. */
function whatWords(list, n) {
  const cats = [...new Set(list.map((c) => c.category))];
  return cats.length === 1 ? plural(lowerFirst(cats[0]), n) : n === 1 ? "business" : "businesses";
}
/** "Tampa, FL and Orlando, FL", or "5 places". */
function placeWords(list) {
  const p = [...new Set(list.map(where))];
  return p.length > 2 ? p.length + " places" : p.join(" and ");
}
function showPlan(plan) {
  if (plan.mode !== "plan") return showStarted(plan);
  const free = plan.source === "free";
  const req = lastRequest || {};
  const phones = plan.checkPhones;
  const combos = plan.combinations;
  const have = combos.filter((c) => c.existing);
  const running = have.filter((c) => RUNNING.includes(c.existing.status));
  const ready = have.filter((c) => !RUNNING.includes(c.existing.status));
  const missing = combos.filter((c) => !c.existing && !c.blocked);
  const blocked = combos.filter((c) => !c.existing && c.blocked);
  const haveBiz = have.reduce((s, c) => s + (c.existing.leads_in_database || 0), 0);
  const oneType = new Set(combos.map((c) => c.category)).size === 1;
  const b = plan.budget;
  const cost = free ? 0 : plan.estimatedCostMissing;
  const overBudget = !free && !!b && missing.length > 0 && cost > b.left + 1e-9;
  const allOverBudget = !free && !!b && plan.estimatedCostAll > b.left + 1e-9;
  const checks = plan.existingPhoneChecks || 0;

  let html = '<div class="rprob info" id="staleNote" hidden>You changed the search. Press Search to update this.</div>';
  // 1. Already in the database.
  if (have.length) {
    const showLabel = phones && checks ? "Show them + check " + num(checks) + " phone" + (checks > 1 ? "s" : "") + (plan.estimatedCostExisting > 0 ? " · up to " + money(plan.estimatedCostExisting) : "") : "Show them";
    html += '<div class="rline"><div class="rtext"><span class="big">' + num(haveBiz) + "</span> " + esc(whatWords(have, haveBiz)) + " in " + esc(placeWords(have)) + " already in your database" +
      (running.length ? ' <span class="pill warn" title="' + esc(names(running, 3)) + '">still collecting</span>' : "") + "</div>" +
      '<div class="actions"><button type="button" id="useHave"' + (missing.length ? ' class="ghost"' : "") + ">" + esc(showLabel) + "</button></div></div>";
  }
  // 2. Not collected yet.
  if (missing.length) {
    const counted = missing.every((c) => c.count && c.count.total != null);
    const onGoogle = counted ? missing.reduce((s, c) => s + c.count.total, 0) : null;
    const capped = !free && plan.maxResults > 0 && missing.some((c) => c.count && c.count.total > plan.maxResults);
    const parts = free ? ["free"] : [onGoogle != null ? "about " + num(onGoogle) + " on Google" : "", capped ? "first " + num(plan.maxResults) + " each" : "", "up to " + money(cost)].filter(Boolean);
    const whatTxt = oneType ? placeWords(missing) : names(missing, 3);
    html += '<div class="rline"><div class="rtext">Not collected yet: <b>' + esc(whatTxt) + '</b> <span class="muted">(' + esc(parts.join(", ")) + ")</span></div>" +
      '<div class="actions"><button type="button" id="pullMissing" class="big"' + (overBudget ? ' data-off="1" disabled' : "") + ">" +
      (free ? "Collect them (free)" : "Collect them (up to " + money(cost) + ")") + "</button></div></div>";
  }
  // 3. Problems: one short line each, with the fix.
  const prob = (text, cls) => { html += '<div class="rprob ' + (cls || "") + '">' + text + "</div>"; };
  if (overBudget) prob("Only " + money(b.left) + " of this month’s budget is left." + ' <button type="button" class="link" data-switch-source="free">Use free data instead</button>', "bad");
  if (blocked.length && free) prob("Not in the free data: " + esc([...new Set(blocked.map((c) => c.category))].join(", ")) + "." + ' <button type="button" class="link" data-switch-source="google">Check on Google instead</button>');
  if (blocked.length && !free) prob(esc(blocked[0].blocked) + (blocked.length > 1 ? " (" + blocked.length + " searches)" : ""));
  if (plan.unknownPlaces && plan.unknownPlaces.length) prob("Couldn’t find: " + esc(plan.unknownPlaces.join("; ")) + ".");
  if (plan.countsSkipped) prob(esc(plan.countsSkipped), "info");
  const countFail = !free && req.withCounts && !plan.countsSkipped ? combos.find((c) => c.count && c.count.total == null && c.count.error) : null;
  if (countFail) prob("Couldn’t count on Google (" + esc(String(countFail.count.error).replace(/^Count failed: /, "")) + ").");
  if (plan.totalCount != null && plan.totalCount > BIG) prob("That’s " + num(plan.totalCount) + " businesses on Google. Try fewer places or types.");
  html += '<div class="rprob bad planmsg" id="planMsg" role="alert"></div>';
  // 4. Small links.
  let links = SAVE_BTN;
  if (free && me && me.role !== "member") links += '<button type="button" class="link small" id="addHarvest" title="Collected by itself, a batch a day, and refreshed monthly">+ Add to daily free collection</button>';
  if (ready.length && (free || plan.estimatedCostAll > 0)) links += '<button type="button" class="link small" id="refreshAll"' + (allOverBudget ? ' data-off="1" disabled' : "") +
    ' title="Collect everything again, including what you have, for fresh details">Collect everything again' + (free ? "" : " (up to " + money(plan.estimatedCostAll) + ")") + "</button>";
  html += '<div class="rlinks actions">' + links + "</div>";
  // 5. Details: per-search breakdown.
  const inDb = (c) => !c.existing ? '<span class="muted">none yet</span>' : RUNNING.includes(c.existing.status) ? '<span class="pill warn">collecting now</span>'
    : num(c.existing.leads_in_database) + ' <span class="muted">(' + esc(ago(c.existing.created_at)) + ")</span>";
  const rows = combos.map((c) => {
    const third = free ? (c.blocked ? '<span class="muted">not in the free data</span>' : esc((c.freeCategories || []).map((x) => x.replace(/_/g, " ")).join(", ")))
      : !c.count ? '<span class="muted">not counted</span>' : c.count.total == null ? '<span class="muted" title="' + esc(c.count.error || "") + '">couldn’t count</span>' : num(c.count.total);
    const toPay = free ? "" : "<td>" + (c.existing ? '<span class="muted">free (you have it)</span>' : c.blocked ? '<span class="muted">can’t price</span>'
      : "up to " + money(c.pullCost) + (phones && c.phoneCost ? ' <span class="muted">+ ' + money(c.phoneCost) + " phones</span>" : "")) + "</td>";
    return "<tr" + (c.existing ? ' class="muted-row"' : "") + "><td>" + esc(c.category) + "</td><td>" + esc(where(c)) + "</td><td>" + third + "</td><td>" + inDb(c) + "</td>" + toPay + "</tr>";
  }).join("");
  const refine = [req.countWebsite === "no" ? "without a website" : req.countWebsite === "yes" ? "with a website" : "", req.countWithPhone ? "with a phone" : "", req.countVerifiedOnly ? "verified" : ""].filter(Boolean).join(", ");
  const foot = free ? "Free data has no Google rating or reviews. Add them later: Improve → Get Google details."
    : (plan.maxResults ? "Up to " + num(plan.maxResults) + " per search. " : "No limit per search. ") + "Costs shown are the most it can be." +
      (refine ? " Counted " + refine + "; collecting takes every business." : "") + (plan.countCost ? " Counting cost " + money(plan.countCost) + "." : "");
  html += '<details class="breakdown"><summary>Details</summary><div class="table-wrap"><table><thead><tr><th>Type of business</th><th>Where</th><th>' + (free ? "Free data type" : "On Google") +
    "</th><th>In your database</th>" + (free ? "" : "<th>Cost to collect</th>") + "</tr></thead><tbody>" + rows + '</tbody></table></div><div class="hint" style="margin-top:6px">' + esc(foot) + "</div></details>";

  $("plan").hidden = false; emptyAfterSearch();
  $("plan").innerHTML = html;
  if ($("pullMissing")) $("pullMissing").onclick = async () => (free || (await confirmBig(cost))) && runPull("pull_missing");
  if ($("useHave")) $("useHave").onclick = () => (phones && checks ? runPull("use_existing") : (planStarted = true, showResults(plan)));
  if ($("refreshAll")) $("refreshAll").onclick = async () => (await ask("Collect everything again?", free ? "Collects these again from the latest free data. Free." : "Includes what you already have. Up to " + money(plan.estimatedCostAll) + ".",
    free ? "Collect again" : "Collect again · up to " + money(plan.estimatedCostAll), free ? {} : { paid: true })) && runPull("refresh_all");
  if ($("addHarvest")) $("addHarvest").onclick = async () => {
    try {
      const r = await postJson("/api/harvest", { categories: lastRequest.categories, locations: lastRequest.locations, radiusMiles: lastRequest.radiusMiles });
      toast("Added " + r.added + " to the daily free collection" + (r.alreadyListed ? " (" + r.alreadyListed + " already on it)" : "") +
        (r.notInFreeData.length ? ". Not in the free data: " + r.notInFreeData.join(", ") : "") + ".");
    } catch (err) { toast(err.message, "bad"); }
  };
  wireSave();
  $("plan").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
/** Collecting has started: a short line here; the progress card below takes over. */
function showStarted(plan) {
  const started = plan.combinations.filter((c) => c.started && !c.error);
  const failed = plan.combinations.filter((c) => c.error);
  const s = started.length === 1 ? "" : "es";
  $("plan").hidden = false; emptyAfterSearch();
  $("plan").innerHTML = '<div class="rline"><div class="rtext">' +
    (started.length ? (plan.source === "free" ? "Started " + started.length + " free search" + s + ". Results arrive in about 10-15 minutes; you can leave this page."
      : "Started " + started.length + " search" + s + ". Follow it below.")
      : plan.mode === "use_existing" ? (plan.checkPhones ? "Showing what you have; phone checks are queued." : "Showing what you have.")
      : '<span class="err">Nothing could be started.</span>') +
    '</div><button type="button" class="link" id="newSearch">New search</button></div>' +
    (plan.source === "free" && plan.freeCollector && plan.freeCollector.error ? '<div class="rprob">' + esc(plan.freeCollector.error) + "</div>" : "") +
    failed.map((c) => '<div class="rprob bad">' + esc(c.category + " in " + where(c)) + ": " + esc(c.error) + "</div>").join("");
  $("newSearch").onclick = () => {
    $("plan").hidden = true; lastRequest = null; planStarted = false; startedIds = []; renderProgress();
    window.scrollTo({ top: 0, behavior: "smooth" }); $("whatInput").focus();
  };
}

// Saved searches: save the search on screen; list, check again, see what's new, alerts, delete.
const SAVE_BTN = '<button type="button" class="link small" id="saveSearch" title="Run it again later, and get told when new businesses appear">☆ Save this search</button>';
function wireSave() {
  if (!$("saveSearch")) return;
  $("saveSearch").onclick = async () => {
    if (!lastRequest) return;
    const cats = lastRequest.categories || [];
    const name = await askText("Save this search", "Name", (cats.length > 2 ? cats.length + " types" : cats.join(", ")) + (lastRequest.radiusMiles ? " (within " + lastRequest.radiusMiles + " mi)" : ""));
    if (!name) return;
    try { await postJson("/api/saved-searches", { name, request: lastRequest }); await loadSaved(); $("savedCard").scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (err) { toast(err.message, "bad"); }
  };
}
let savedList = [];
async function loadSaved() {
  savedList = await api("/api/saved-searches").catch(() => []);
  $("savedCard").hidden = !savedList.length || currentTab !== "find";
  $("savedRows").innerHTML = savedList.map((s) => "<tr><td><b>" + esc(s.name) + "</b></td><td>" + esc(s.description) + "</td><td>" + (s.total == null ? '<span class="muted">—</span>' : num(s.total)) +
    "</td><td>" + (s.newSince ? '<span class="pill ok">' + num(s.newSince) + " new</span>" : '<span class="muted">none</span>') + ' <span class="muted">since ' + esc(ago(s.since)) + '</span></td><td class="nowrap">' +
    '<button type="button" class="ghost small" data-saved-run="' + esc(s.id) + '" title="Shows what’s new and any cost. Nothing is collected until you say so.">Check again</button> ' +
    (s.newSince ? '<button type="button" class="ghost small" data-saved-new="' + esc(s.id) + '">See new</button> ' : "") +
    '<label class="muted small" title="A notification when new businesses appear"><input type="checkbox" data-saved-alert="' + esc(s.id) + '"' + (s.alert_new ? " checked" : "") + "> alerts</label> " +
    '<button type="button" class="link small" data-saved-del="' + esc(s.id) + '">Delete</button></td></tr>').join("");
}
$("savedRows").addEventListener("click", async (e) => {
  const run = e.target.closest("[data-saved-run]"), fresh = e.target.closest("[data-saved-new]"), del = e.target.closest("[data-saved-del]");
  const id = (run && run.dataset.savedRun) || (fresh && fresh.dataset.savedNew) || (del && del.dataset.savedDel);
  const s = id ? savedList.find((x) => x.id === id) : null;
  try {
    if (del && s && (await ask("Delete this saved search?", "“" + s.name + "” will be deleted. Businesses you collected stay in your database.", "Delete", { danger: true }))) { await api("/api/saved-searches/" + s.id, { method: "DELETE" }); return loadSaved(); }
    if (run && s) {
      run.disabled = true;
      const plan = await postJson("/api/find", { ...s.request, mode: "plan" });
      lastRequest = s.request; planStarted = false; startedIds = [];
      lastCountFilters = { website: s.request.countWebsite, phone: s.request.countWithPhone, verified: s.request.countVerifiedOnly }; lastPhoneTypes = [];
      renderProgress(); showPlan(plan);
      await api("/api/saved-searches/" + s.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ran: true }) });
      run.disabled = false;
    }
    if (fresh && s) {
      // The Database tab, filtered to these types added since the team last looked.
      const since = s.since.slice(0, 10);
      await api("/api/saved-searches/" + s.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seen: true }) });
      setTab("database");
      restore({ ...defaultFilters, scope: null, label: "" });
      f.category.set(s.request.categories);
      const cities = s.request.locations.filter((l) => l.city).map((l) => l.city + "|" + (l.region || ""));
      if (s.request.radiusMiles && cities.length === 1) { view.text.near = cities[0]; view.text.radius = String(s.request.radiusMiles); }
      else if (cities.length) f.city.set(cities);
      else f.state.set(s.request.locations.map((l) => l.region).filter(Boolean));
      view.text.addedFrom = since;
      Object.values(f).forEach((d) => d.renderChip());
      reload();
    }
  } catch (err) { toast(err.message, "bad"); if (run) run.disabled = false; }
});
$("savedRows").addEventListener("change", async (e) => {
  const box = e.target.closest("[data-saved-alert]"); if (!box) return;
  await api("/api/saved-searches/" + box.dataset.savedAlert, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ alert: box.checked }) }).catch((err) => toast(err.message, "bad"));
});

// Step 3: one row per search with a progress bar; stop / resume in place.
const STAGE = {
  pending: ["Starting…", 8], scraping: ["Collecting on Google Maps…", 40], ingesting: ["Saving to your database…", 75],
  enriching: ["Checking…", 90], done: ["Ready", 100], failed: ["Failed", 100],
};
const FREE_STAGE = { pending: ["Waiting for the free collector…", 8], scraping: ["Collecting open map data…", 40], ingesting: ["Saving to your database…", 75] };
const DETAILS_STAGE = { pending: ["Starting…", 8], scraping: ["Looking up on Google Maps…", 40], ingesting: ["Adding Google details…", 75] };
function stageOf(s) { return (s.source === "free" ? FREE_STAGE[s.status] : s.source === "google_details" ? DETAILS_STAGE[s.status] : null) || STAGE[s.status] || [s.status, 50]; }
function placeLabel(s) {
  if (s.source === "google_details") return num(s.max_results) + " businesses";
  if (s.source === "upload") return "uploaded list";
  return (s.city ? s.city + ", " : "all of ") + (s.region_name || s.state || s.country || "") + (s.radius_miles && s.city ? " (within " + s.radius_miles + " mi)" : ""); }
function renderProgress() {
  if (!startedIds.length || currentTab !== "find") { $("progress").hidden = true; return; }
  const rows = startedIds.map((id) => pulls.find((p) => p.id === id)).filter(Boolean);
  if (!rows.length) return;
  const running = rows.filter((s) => RUNNING.includes(s.status));
  const saved = rows.reduce((n, s) => n + (s.leads_in_database || 0), 0);
  const failed = rows.filter((s) => s.status === "failed");
  const head = running.length
    ? "Collecting… " + (rows.length - running.length) + " of " + rows.length + " done · " + num(saved) + " saved so far"
    : failed.length ? "Finished with problems · " + num(saved) + " saved" : "All done · " + num(saved) + " saved";
  $("progress").hidden = false;
  $("progress").innerHTML = '<h2 class="proghead">' + esc(head) + "</h2>" +
    (running.length ? '<div class="hint" style="margin-bottom:6px">They appear in the list below as they’re saved. You can leave this page.</div>' : "") +
    rows.map((s) => {
      let [label, pct] = stageOf(s);
      const stopped = !!s.cancelled_at && s.status === "done";
      const exp = s.source === "free" ? s.rows_expected || 0 : expectedById[s.id] || s.max_results || 0;
      if (s.status === "ingesting" && exp) pct = Math.min(95, 75 + Math.round(20 * (s.leads_in_database || 0) / exp));
      const text = s.status === "done" ? (stopped ? "Stopped · kept " + num(s.leads_in_database) : !s.leads_in_database ? (s.source === "free" ? "None in the free data here" : s.source === "google_details" ? "Done" : "None on Google here") : "Ready · " + num(s.leads_in_database) + " businesses")
        : s.status === "ingesting" ? "Saving… " + num(s.leads_in_database) + (exp ? " of ~" + num(exp) : "") + " saved" : label;
      const cls = s.status === "failed" ? "bad" : s.status === "done" ? (stopped ? "warn" : "ok") : "run";
      const btn = (s.status === "pending" || s.status === "scraping" || (s.source === "free" && s.status === "ingesting")) && !s.cancelled_at ? '<button type="button" class="ghost small danger" data-cancel="' + esc(s.id) + '">Stop</button>'
        : s.status === "failed" && s.apify_run_id ? '<button type="button" class="ghost small" data-resume="' + esc(s.id) + '">Resume</button>' : "";
      return '<div class="prow"><div class="pname">' + esc(s.category) + ' <span class="muted">· ' + esc(placeLabel(s)) + "</span></div>" +
        '<div class="pbar ' + cls + '"><i style="width:' + pct + '%"></i></div><div class="pstate ' + cls + '">' + esc(text) + "</div><div>" + btn + "</div>" +
        (s.error && (s.status === "failed" || /^Paused/.test(s.error)) ? '<div class="perr"' + (s.status === "failed" ? "" : ' style="color:var(--warn)"') + ">" + esc(s.error) + "</div>" : "") + "</div>";
    }).join("");
}
async function pullAction(e, after) {
  const c = e.target.closest("[data-cancel]");
  if (c) {
    if (!(await ask("Stop this search?", "What it already collected is kept.", "Stop it", { danger: true }))) return true;
    c.disabled = true;
    try { await api("/api/searches/" + c.dataset.cancel + "/cancel", { method: "POST" }); tracked.add(c.dataset.cancel); startPolling(); } catch (err) { toast(err.message, "bad"); }
    await loadPulls(); after(); return true;
  }
  const r = e.target.closest("[data-resume]");
  if (r) {
    r.disabled = true;
    try { await api("/api/searches/" + r.dataset.resume + "/resume", { method: "POST" }); tracked.add(r.dataset.resume); startPolling(); } catch (err) { toast(err.message, "bad"); }
    await loadPulls(); after(); return true;
  }
  return false;
}
$("progress").onclick = (e) => pullAction(e, renderProgress);
// One click to try the same search with the other data (free / Google Maps).
$("plan").addEventListener("click", (e) => {
  const b = e.target.closest("[data-switch-source]"); if (!b) return;
  const r = document.querySelector('input[name="source"][value="' + b.dataset.switchSource + '"]'); if (!r) return;
  r.checked = true; applySource();
  $("searchCard").scrollIntoView({ behavior: "smooth", block: "start" });
  $("findBtn").click();
});
let lastPhoneTypes = [];
/** Show a plan's businesses with the default filters, plus what the search asked for (phone types, counts). */
function showResults(plan) {
  if (!plan.searchIds || !plan.searchIds.length) return;
  restore({ ...defaultFilters, scope: null, label: "" });
  if (lastCountFilters.website === "no") f.website.set(["no"]);
  if (lastCountFilters.website === "yes") f.website.set(["yes"]);
  if (lastCountFilters.phone) f.phone.set(["yes"]);
  if (lastPhoneTypes.length) { f.phoneType.set(lastPhoneTypes); f.phone.set(["yes"]); }
  useScope(plan.searchIds, planLabel(plan));
}
function confirmBig(cost) {
  // Any Google collection over $2 is confirmed in plain words first.
  return cost == null || cost < 2 || ask("Start collecting?", "This could cost up to " + money(cost) + " from this month’s budget.", "Collect · up to " + money(cost), { paid: true });
}
async function runPull(mode) {
  const buttons = [...document.querySelectorAll("#plan .actions button")];
  buttons.forEach((b) => b.disabled = true);
  if ($("planMsg")) $("planMsg").textContent = "";
  try {
    const result = await postJson("/api/find", { ...lastRequest, mode });
    planStarted = true;
    startedIds = result.startedIds || [];
    startedIds.forEach((id) => tracked.add(id));
    result.combinations.forEach((c) => { if (c.started) expectedById[c.started.id] = c.expected || c.pullCap; });
    if (result.checkPhones) phonesWatched = true;
    showPlan(result);
    await loadPulls();
    renderProgress();
    showResults(result);
    if (startedIds.length || result.checkPhones) startPolling();
    loadSpend(); loadNotifications();
  } catch (err) {
    // Show the refusal right under the buttons, and let them try again.
    if ($("planMsg")) { $("planMsg").textContent = err.message; $("planMsg").scrollIntoView({ behavior: "smooth", block: "center" }); }
    else toast(err.message, "bad");
    buttons.forEach((b) => b.disabled = b.dataset.off === "1");
  }
}
// ---------------------------------------------------------------------------
// Results scope + filters
// ---------------------------------------------------------------------------
const view = { scope: null, scopeLabel: "", page: 1, sort: "added", dir: "desc", text: {} };
let facets = null, pulls = [];
const f = {}; // filter dropdowns by key

function countOf(rows, value) { const r = (rows || []).find((x) => x.value === value); return r ? r.n : 0; }
function fromFacet(rows, labels) { return (rows || []).filter((r) => r.value != null).map((r) => ({ value: r.value, label: (labels && labels[r.value]) || r.value, n: r.n })); }

const CORE_FILTERS = ["state", "city", "category", "score", "website", "phone", "email", "leadStatus", "assigned"];
// One-tap filters: [filter, value, label, tooltip]. Each just switches that value of an existing filter on or off.
const QUICK = [
  ["phone", "yes", "Has phone", "With a phone number"], ["email", "yes", "Has email", "With an email address"],
  ["website", "no_real", "No website", "No website, or only a Facebook / directory page"], ["score", "weak", "Weak online presence", "Score under 40: the most to fix"],
  ["owner", "yes", "Owner name", "The owner’s name is known"], ["assigned", "me", "My leads", "Assigned to me"], ["leadStatus", "Untouched", "Not contacted yet", "Stage: Untouched"],
];
function renderQuick() {
  const box = $("quickChips"); if (!box) return;
  box.innerHTML = QUICK.map(([k, v, label, tip], i) => { const on = !!f[k] && f[k].selected.has(v);
    return '<button type="button" class="qchip' + (on ? " on" : "") + '" data-quick="' + i + '" aria-pressed="' + on + '" title="' + esc(tip) + '">' + (on ? "✓ " : "") + esc(label) + "</button>"; }).join("");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-quick]"); if (!b) return;
  const [k, v] = QUICK[Number(b.dataset.quick)], d = f[k];
  if (d.selected.has(v)) d.selected.delete(v); else { if (d.cfg.single) d.selected.clear(); d.selected.add(v); }
  d.renderChip(); reload();
});
const MORE_FILTERS = [
  ["Location", ["neighborhood", "postal", "distance"]],
  ["Category", ["industry", "exclude", "top100"]],
  ["Business", ["status", "verified", "location", "price", "photos", "attribute"]],
  ["Reputation", ["rating", "reviews", "position"]],
  ["Contact", ["phoneType", "emailCheck", "owner", "dedupe", "dataSource"]],
  ["Website", ["chain", "siteCheck", "siteProblem", "builder", "ads"]],
  ["Other", ["dates", "dnc"]],
];
/** "Showing:" chips for every filter that is on, each with × to take it off. */
function renderActive() {
  const box = $("activeChips"); if (!box) return;
  const isOn = (d) => (d.cfg.custom ? d.cfg.isOn() : d.selected.size > 0);
  const chips = Object.entries(f).filter(([, d]) => isOn(d)).map(([k, d]) => [k, d.summary()]);
  if (view.text.q) chips.push(["__q", "Name contains “" + view.text.q + "”"]);
  if (view.text.area) chips.push(["__area", "Inside the area drawn on the map"]);
  if (view.text.ai) chips.push(["__ai", "Exact limits from your description"]);
  box.innerHTML = chips.length ? '<span class="hint">Showing:</span> ' + chips.map(([k, t]) => '<span class="tag">' + esc(t) +
    ' <button type="button" data-unfilter="' + esc(k) + '" aria-label="Remove this filter" title="Remove this filter">×</button></span>').join("") : '<span class="hint">Showing: everything (no filters)</span>';
  const moreOn = Object.values(f).filter(isOn).length;
  $("moreOn").hidden = !moreOn; $("moreOn").textContent = moreOn + " on";
  renderQuick();
  // On the Database tab the search row shows the type / state / city filters: keep it in step.
  if (acWhat && isDb()) { acWhat.render(); acWhere.render(); }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-unfilter]"); if (!b) return;
  const k = b.dataset.unfilter;
  if (k === "__q") { view.text.q = ""; $("nameSearch").value = ""; }
  else if (k === "__area") delete view.text.area;
  else if (k === "__ai") view.text.ai = null;
  else if (k === "distance") { view.text.radius = ""; view.text.near = ""; }
  else if (k === "dates") ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].forEach((x) => { view.text[x] = ""; });
  else if (f[k]) f[k].selected.clear();
  if (f[k]) f[k].renderChip();
  reload();
});
function buildFilters() {
  const bar = $("filterbar");
  // One-tap chips and the name search are always shown; every dropdown folds away under "More filters".
  bar.innerHTML = '<div class="fgroup"><div id="quickChips" class="quick"></div><div id="f-name"></div><div id="f-clear"></div></div>' +
    '<div id="activeChips" class="activechips"></div>' +
    '<details class="morefilters" id="moreFilters"><summary>More filters <span id="moreOn" class="pill" hidden></span></summary>' +
    '<div class="fgroup core"><span class="glabel">Main</span>' + CORE_FILTERS.map((k) => '<div id="f-' + k + '"></div>').join("") + "</div>" +
    MORE_FILTERS.map(([g, keys]) => '<div class="fgroup"><span class="glabel">' + g + "</span>" + keys.map((k) => '<div id="f-' + k + '"></div>').join("") + "</div>").join("") + "</details>";
  // Counts next to options are worked out when a dropdown is opened (and respect the other filters).
  const beforeOpen = () => (facetsStale ? loadFacets().then(() => true) : Promise.resolve(false));
  const multi = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "All", options, onChange: reload, beforeOpen, ...(extra || {}) }); };
  const single = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "Any", single: true, search: false, options, onChange: reload, beforeOpen, ...(extra || {}) }); };

  multi("state", "State", () => fromFacet(facets && facets.states));
  // "City|ST" so two cities with the same name in different states stay separate.
  multi("city", "City", () => ((facets && facets.cities) || []).filter((c) => !f.state.selected.size || f.state.selected.has(c.state)).map((c) => ({ value: c.city + "|" + (c.state || ""), label: c.city + (c.state ? ", " + c.state : ""), n: c.n })));
  multi("neighborhood", "Neighborhood", () => ((facets && facets.neighborhoods) || []).map((r) => ({ value: r.value, label: r.value + (r.city ? ", " + r.city : ""), n: r.n })), { hint: "The 500 most common; type to search.", emptyText: "No neighborhoods for these businesses. Google Maps results have them; the free data doesn’t." });
  multi("postal", "ZIP code", () => fromFacet(facets && facets.postalCodes), { hint: "The 500 most common; type to search." });
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
  multi("verified", "Verification", () => [{ value: "verified", label: "Verified on Google (or not known yet)", n: countOf(facets && facets.verified, "verified") }, { value: "unverified", label: "Not verified", n: countOf(facets && facets.verified, "unverified") }], { selected: new Set(["verified"]) });
  multi("location", "Location type", () => [{ value: "storefront", label: "Physical location (street address)", n: countOf(facets && facets.location, "storefront") }, { value: "service_area", label: "Service area only", n: countOf(facets && facets.location, "service_area") }]);
  multi("price", "Price", () => ["$", "$$", "$$$", "$$$$"].map((v) => ({ value: v, label: v, n: countOf(facets && facets.prices, v) })));
  single("photos", "Photos", () => [{ value: "", label: "Any" }, ...[1, 10, 25, 50, 100].map((n) => ({ value: String(n), label: n + "+ photos" }))]);
  multi("attribute", "Has all of these features", () => fromFacet(facets && facets.attributes), { allLabel: "Any", noBulk: true, hint: "Businesses must have every feature you tick.", emptyText: "No features listed for these businesses. Google Maps results have them; the free data doesn’t (use Look up to get them)." });

  single("rating", "Rating", () => [{ value: "", label: "Any rating" },
    ...["4.5", "4.0", "3.5", "3.0", "2.5", "2.0"].map((v) => ({ value: "min:" + v, label: v + " and up" })),
    ...["4.0", "3.5", "3.0", "2.5", "2.0", "1.5"].map((v) => ({ value: "max:" + v, label: v + " and below" }))]);
  multi("reviews", "Reviews", () => Object.keys(REVIEW_LABELS).map((k) => ({ value: k, label: REVIEW_LABELS[k], n: countOf(facets && facets.reviewBuckets, k) })));
  single("position", "Position", () => [{ value: "", label: "Any position" },
    ...[3, 10, 20, 50].map((n) => ({ value: "rank:" + n, label: n === 3 ? "Top 3 (map pack)" : "Top " + n })),
    ...[1, 5, 10, 25].map((n) => ({ value: "pct:" + n, label: "Top " + n + "% of results" }))]);

  single("phone", "Phone", () => [{ value: "", label: "All" }, { value: "yes", label: "With a phone number" }, { value: "no", label: "Without a phone number" }]);
  multi("phoneType", "Phone type", () => ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"].map((v) => ({ value: v, label: PHONE_LABELS[v], n: countOf(facets && facets.phoneTypes, v) })));
  single("website", "Website", () => [{ value: "", label: "All" },
    { value: "yes", label: "Has a real website", n: countOf(facets && facets.websites, "yes") },
    { value: "no_real", label: "No real website (none, or only a Facebook / directory page)" },
    { value: "no", label: "No website at all", n: countOf(facets && facets.websites, "no") },
    { value: "social", label: "Only a Facebook / Yelp / directory page", n: countOf(facets && facets.websites, "social") }]);
  multi("dataSource", "Data", () => [["google", "Google Maps"], ["free", "Free data only"], ["free+google", "Free + Google details"]]
    .map(([v, label]) => ({ value: v, label, n: countOf(facets && facets.dataSources, v) })), { search: false });
  multi("dedupe", "Remove duplicates", () => [{ value: "website", label: "One business per website" }, { value: "phone", label: "One business per phone number" }, { value: "listing", label: "One per Google listing" }], { allLabel: "off", search: false });
  single("email", "Email", () => [{ value: "", label: "All" }, { value: "yes", label: "Has an email address" },
    { value: "personal", label: "Has a person’s email (not info@ or Gmail)" }, { value: "no", label: "No email address" }]);
  multi("emailCheck", "Email check", () => [["ok", "Verified email"], ["risky", "Risky (catch-all or unknown)"], ["bad", "Has an email that bounces"], ["unchecked", "Email not verified yet"]]
    .map(([v, label]) => ({ value: v, label })), { search: false });
  multi("score", "Score", () => [["weak", "Weak (0-39): the most to fix"], ["basic", "Basic (40-59)"], ["good", "Good (60-79)"], ["strong", "Strong (80+)"], ["none", "Not scored yet"]]
    .map(([v, label]) => ({ value: v, label, n: countOf(facets && facets.scores, v) })), { search: false, hint: "Overall online presence (Google profile + website). Low scores = more for you to fix = better prospects." });
  single("chain", "Chains", () => [{ value: "", label: "All businesses" },
    { value: "hide", label: "Hide chains & franchises", n: countOf(facets && facets.chains, "hide") },
    { value: "only", label: "Only chains & franchises", n: countOf(facets && facets.chains, "only") }], { allLabel: "all" });
  multi("siteCheck", "Website check", () => [["works", "Website works"], ["broken", "Website doesn’t load"], ["blocked", "Couldn’t read it (blocks checks)"], ["not_checked", "Not checked yet"]]
    .map(([v, label]) => ({ value: v, label, n: countOf(facets && facets.siteChecks, v) })), { search: false });
  multi("siteProblem", "Website problems", () => Object.entries(SITE_PROBLEM_LABELS).map(([v, label]) => ({ value: v, label })),
    { allLabel: "Any", noBulk: true, search: false, hint: "Businesses must have every problem you tick (checked websites only).", emptyText: "Nothing to pick" });
  multi("ads", "Advertising", () => [["google_ads", "Runs Google Ads (tag on the website)"], ["call_tracking", "Uses call tracking (usually paid ads)"],
    ["meta_pixel", "Has a Meta (Facebook) pixel"], ["bing_ads", "Runs Microsoft Ads"], ["none", "No advertising signs"]].map(([v, label]) => ({ value: v, label })),
    { search: false, hint: "Signs on the website that a business pays for ads (checked websites only)." });
  single("owner", "Owner", () => [{ value: "", label: "All" }, { value: "yes", label: "Owner name known" }, { value: "no", label: "Owner name not known" }]);
  multi("builder", "Built with", () => fromFacet(facets && facets.builders, BUILDER_LABELS), { search: false, emptyText: "No websites checked yet." });

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
  single("dnc", "Do-not-contact", () => [{ value: "", label: "Hidden (the usual)" }, { value: "show", label: "Show them too" }, { value: "only", label: "Only the do-not-contact list" }], { allLabel: "hidden" });
  multi("leadStatus", "Stage", () => fromFacet(facets && facets.leadStatuses));
  multi("assigned", "Assigned to", () => [{ value: "me", label: "Me (my leads)" }, { value: "none", label: "Nobody yet" },
    ...team.filter((t) => !me || t.id !== me.id).map((t) => ({ value: t.id, label: t.name }))], { search: false });
  $("f-name").innerHTML = '<input type="search" id="nameSearch" placeholder="Search by business name…" aria-label="Search by business name" style="border-radius:99px;padding:4px 11px">';
  let typing; $("nameSearch").oninput = () => { clearTimeout(typing); typing = setTimeout(() => { view.text.q = $("nameSearch").value.trim(); reload(); }, 300); };
  $("f-clear").innerHTML = '<button type="button" class="link" id="clearFilters" title="Back to the usual view: open, verified businesses">Reset filters</button>';
  $("clearFilters").onclick = () => {
    restore({ ...defaultFilters, scope: view.scope, label: view.scopeLabel });
    reload();
  };
}
// Category -> industry, built once when the category list loads.
let industryByCat = null;
function industryOfCategory(cat) {
  if (!tree) return "Other";
  if (!industryByCat) industryByCat = new Map(tree.industries.flatMap((i) => i.categories.map((c) => [c.name.toLowerCase(), i.industry])));
  return industryByCat.get(String(cat).toLowerCase()) || "Other";
}

function query() {
  const p = new URLSearchParams({ page: view.page, sort: view.sort, dir: view.dir });
  if (view.scope) view.scope.forEach((id) => p.append("search_id", id));
  const add = (key, dd) => dd && dd.selected.forEach((v) => p.append(key, v));
  add("state", f.state); add("city", f.city); add("neighborhood", f.neighborhood); add("postal_code", f.postal);
  add("industry", f.industry); add("category", f.category); add("exclude_category", f.exclude);
  add("status", f.status); add("verified", f.verified); add("location", f.location); add("price", f.price); add("attribute", f.attribute);
  add("reviews", f.reviews); add("phone_type", f.phoneType); add("lead_status", f.leadStatus); add("assigned", f.assigned); add("data_source", f.dataSource);
  const one = (dd) => [...dd.selected][0] || "";
  if (one(f.top100)) p.set("top100", "1");
  if (one(f.photos)) p.set("min_photos", one(f.photos));
  const rating = one(f.rating); if (rating) p.set(rating.startsWith("min:") ? "min_rating" : "max_rating", rating.slice(4));
  const pos = one(f.position); if (pos) p.set(pos.startsWith("rank:") ? "max_rank" : "top_pct", pos.split(":")[1]);
  if (one(f.phone)) p.set("phone", one(f.phone));
  if (one(f.website)) p.set("website", one(f.website));
  if (one(f.email)) p.set("email", one(f.email));
  if (one(f.chain)) p.set("chain", one(f.chain));
  if (one(f.owner)) p.set("owner", one(f.owner));
  if (one(f.dnc)) p.set("dnc", one(f.dnc));
  add("ads", f.ads); add("email_check", f.emailCheck);
  add("score", f.score); add("site_check", f.siteCheck); add("site_problem", f.siteProblem); add("builder", f.builder);
  f.dedupe.selected.forEach((v) => p.set("dedupe_" + v, "1"));
  if (view.text.radius && view.text.near) { p.set("radius_miles", view.text.radius); p.set("near", view.text.near); }
  // Exact numbers from a plain-English search that the chips can't show (reviews / rating limits).
  if (view.text.ai) for (const [k, v] of Object.entries(view.text.ai)) p.set(k, v);
  if (view.text.area) p.set("area", view.text.area);
  const map = { q: "q", addedFrom: "added_from", addedTo: "added_to", updatedFrom: "updated_from", updatedTo: "updated_to" };
  for (const [k, key] of Object.entries(map)) if (view.text[k]) p.set(key, view.text[k]);
  return p;
}
/** The current filters without paging (for counts, phone checks and the CSV). */
function filterQuery() { const p = query(); p.delete("page"); return p; }

function useScope(searchIds, label) {
  view.scope = searchIds && searchIds.length ? searchIds : null;
  view.scopeLabel = label || "";
  view.page = 1;
  $("emptyState").hidden = true; $("resultsBody").hidden = false; $("filtersCard").hidden = false;
  refreshAll();
}
// The list must never depend on the filter counts: if the counts fail, the businesses still show.
async function refreshAll() {
  facetsStale = true;
  try { await loadFacets(); } catch (err) { console.error("filter counts failed", err); }
  $("mapBtn").textContent = view.text.area ? "Map · area on" : "Map";
  if (!$("mapCard").hidden) loadMap().catch((err) => { $("mapInfo").textContent = err.message; });
  await loadLeads();
}
// Filter counts are refreshed when a dropdown is opened after a change, not on every click.
function reload() {
  view.page = 1; facetsStale = true; loadLeads();
  $("mapBtn").textContent = view.text.area ? "Map · area on" : "Map";
  if (!$("mapCard").hidden) loadMap().catch((err) => { $("mapInfo").textContent = err.message; });
}
let facetsStale = true;
async function loadFacets() {
  const p = filterQuery(); p.delete("sort"); p.delete("dir");
  facets = await api("/api/leads/facets?" + p);
  facetsStale = false;
  Object.values(f).forEach((d) => d.refresh());
}

/** "+14075550101" -> "(407) 555-0101"; other countries keep "+<digits>". */
function phoneText(e164, raw) {
  const d = String(e164 || "").replace(/[^0-9]/g, "");
  if (d.length === 11 && d[0] === "1") return "(" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7);
  return e164 || raw || "";
}
const isDefault = (dd, values) => dd.selected.size === values.length && values.every((v) => dd.selected.has(v));
let leadsSeq = 0;
async function loadLeads() {
  if ($("resultsBody").hidden) return;
  renderActive();
  const seq = ++leadsSeq;
  let data;
  try {
    data = await api("/api/leads?" + query());
  } catch (err) {
    if (seq !== leadsSeq) return;
    $("count").textContent = "Couldn’t load the list";
    $("rows").innerHTML = '<tr><td colspan="17" class="empty-state">' + esc(err.message) + ' <button type="button" class="link" id="retryList">Try again</button></td></tr>';
    $("retryList").onclick = () => loadLeads();
    return;
  }
  if (seq !== leadsSeq) return; // an older answer arriving late: a newer one is on its way
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $("count").textContent = data.total.toLocaleString() + " business" + (data.total === 1 ? "" : "es");
  const hidden = data.inScope != null ? data.inScope - data.total - (data.duplicatesHidden || 0) : 0;
  $("dupInfo").innerHTML = (data.duplicatesHidden ? "(" + num(data.duplicatesHidden) + " duplicate" + (data.duplicatesHidden === 1 ? "" : "s") + " hidden) " : "") +
    (hidden > 0 ? "· " + num(hidden) + " more hidden by filters " + '<button type="button" class="link small" id="showAllHere">show all</button>' : "");
  if ($("showAllHere")) $("showAllHere").onclick = () => { Object.values(f).forEach((d) => d.selected.clear()); view.text = {}; $("nameSearch").value = ""; Object.values(f).forEach((d) => d.renderChip()); reload(); };
  const running = view.scope ? pulls.filter((p) => view.scope.includes(p.id) && RUNNING.includes(p.status)).length : 0;
  const unusual = !isDefault(f.status, ["operational"]) || !isDefault(f.verified, ["verified"]);
  $("scopeInfo").innerHTML = (view.scope ? '<span class="pill">' + esc(view.scopeLabel || view.scope.length + " searches") + '</span> <button type="button" class="link small" id="clearScope">show everything we have</button>' : '<span class="pill">everything collected</span>') +
    (unusual ? ' <span class="pill warn filterwarn" title="The usual view shows only open, verified businesses">includes closed or not-verified businesses</span>' : "") +
    (running ? ' <span class="pill warn">' + running + " still collecting…</span>" : "") +
    (phoneState && phoneState.message ? ' <span class="pill ' + (/paused|no_service/.test(phoneState.state) ? "bad" : "warn") + '">' + esc(phoneState.message) + "</span>" : "") +
    (data.nearNotFound ? ' <span class="pill bad">no businesses with a map position in that place yet</span>' : "");
  if ($("clearScope")) $("clearScope").onclick = () => useScope(null, "");
  $("pageInfo").textContent = "Page " + data.page + " of " + pages;
  $("prevBtn").disabled = data.page <= 1; $("nextBtn").disabled = data.page >= pages;
  $("downloadBtn").disabled = data.total === 0; $("checkPhonesBtn").disabled = data.total === 0; $("checkSitesBtn").disabled = data.total === 0;
  $("downloadBtn").textContent = "Download " + num(data.total);
  const paused = phoneState && /paused|no_service/.test(phoneState.state);
  $("rows").innerHTML = data.results.length ? data.results.map((l) => {
    const type = l.phone_type || (l.gbp_phone_formatted ? "unchecked" : "no_phone");
    const site = isWebLink(l.website)
      ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">' + esc(l.website_domain || l.website.replace(/^https?:\\/\\/(www\\.)?/, "").split(/[/?#]/)[0]) + "</a>" + (l.website_domain ? "" : ' <span class="muted">(social / directory page)</span>')
      : '<span class="muted">None</span>';
    const isFree = l.data_source === "free" || l.data_source === "upload";
    const mapsSearch = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([l.business_name, l.address || l.city].filter(Boolean).join(" "));
    const name = (isWebLink(l.gbp_url) ? '<a href="' + esc(l.gbp_url) + '" target="_blank" rel="noopener">' + esc(l.business_name) + "</a>"
      : '<a href="' + esc(mapsSearch) + '" target="_blank" rel="noopener" title="Search Google Maps for this business">' + esc(l.business_name) + "</a>") +
      (l.data_source === "upload" ? ' <span class="pill free" title="From a list you uploaded">uploaded</span>' : isFree ? ' <span class="pill free" title="From the free open map data">free</span>' : l.data_source === "free+google" ? ' <span class="pill free" title="Free data + Google details">free + Google</span>' : "") +
      (l.owner_name ? '<div class="cellnote muted" title="' + (l.owner_source === "registry" ? "From the state business registry" : "From the business’s website") + '">👤 ' + esc(l.owner_name) + (l.owner_title ? ", " + esc(l.owner_title) : "") + '</div>' : "") +
      (l.suppressed ? ' <span class="pill bad" title="On the do-not-contact list">do not contact</span>' : "") +
      (l.is_chain === 1 ? ' <span class="pill warn" title="A chain or franchise (a known brand, or its website is shared by businesses in 3+ cities)">chain</span>' : "");
    const verified = l.is_claimed === 0 ? '<span class="pill bad">Not verified</span>'
      : isFree ? (l.google_match === "queued" ? '<span class="pill warn">looking up…</span>' : l.google_match === "not_found" ? '<span class="pill" title="Google Maps had no matching listing">not on Google</span>'
        : '<span class="pill" title="The free data doesn\u2019t say">Unknown</span><br><button type="button" class="link small nowrap" data-gdetail="' + esc(l.id) + '" title="Get this business\u2019s Google details: verified, rating, reviews (about half a cent)">Look up</button>')
      : '<span class="pill ok">Verified</span>';
    const status = l.business_status === "operational" ? '<span class="pill ok">Open</span>'
      : '<span class="pill ' + (l.business_status === "permanently_closed" ? "bad" : "warn") + '">' + esc(STATUS_LABELS[l.business_status] || l.business_status) + "</span>";
    const loc = l.has_street_address === 0 ? "Service area" : l.has_street_address === 1 ? "Physical" : "";
    // Phone type cell: the answer (kept while a re-check runs), or where the check stands.
    const queued = l.phone_check_requested > 0;
    const typeText = type === "unchecked"
      ? (queued ? (paused ? "Waiting (checks paused)" : "Checking…") : l.enrichment_error ? "Couldn’t check" : PHONE_LABELS.unchecked)
      : type === "no_phone" ? '<span class="muted">No phone</span>' : esc(PHONE_LABELS[type] || type) + (queued ? ' <span class="muted">(re-checking…)</span>' : "");
    const action = type === "unchecked" && !queued ? ' <button type="button" class="link small" data-checkphone="' + esc(l.id) + '">Check' + (l.enrichment_error ? " again" : "") + "</button>"
      : l.phone_type && l.phone_type !== "toll_free" && !queued ? ' <button type="button" class="link small recheck" data-recheckphone="' + esc(l.id) + '" title="Check this number again" aria-label="Check this number again">↻</button>' : "";
    // data-label lets small screens show each business as a labelled card instead of a wide row.
    const cell = (label, html, cls) => '<td data-label="' + label + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + html + "</td>";
    const stageCell = '<button type="button" class="link small stagepill" data-lead="' + esc(l.id) + '" title="Stage, assignment and notes">' + esc(l.lead_status || "Untouched") + "</button>" +
      (l.assigned_name ? '<div class="cellnote muted">→ ' + esc(l.assigned_name) + "</div>" : "") + (l.notes_count ? '<div class="cellnote muted">📝 ' + esc(l.notes_count) + "</div>" : "");
    return "<tr>" + cell("Business", name, "name") + cell("Score", scoreCell(l)) + cell("Stage", stageCell) + cell("Category", esc(l.gbp_category)) + cell("Phone", esc(phoneText(l.gbp_phone_formatted, l.gbp_phone_raw))) +
      cell("Phone type", typeText + (l.phone_carrier ? ' <span class="muted">' + esc(l.phone_carrier) + "</span>" : "") + action, "type-" + esc(type)) +
      cell("Website", site + siteFacts(l)) + cell("Rating", esc(l.rating ?? "")) + cell("Reviews", esc(l.review_count ?? "")) + cell("Position", esc(l.gbp_rank ?? "")) +
      cell("Verified", verified) + cell("Status", status) + cell("Location", esc(loc)) + cell("City", esc(l.city)) + cell("State", esc(l.state)) +
      cell("Neighborhood", esc(l.neighborhood)) + cell("Added", esc(l.lead_date)) + "</tr>";
  }).join("") : '<tr><td colspan="17" class="empty-state">' + (running
    ? "Still collecting. They appear here when it finishes."
    : f.phoneType.selected.size && phoneState && phoneState.pending
      ? esc(phoneState.message || "Phone types are still being checked.") + " Businesses appear here as their phones are checked, or untick Phone type to see them all."
      : "No businesses match these filters." + (unusual || hidden > 0 ? "" : " Try Reset filters.")) + "</td></tr>";
}

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.tabIndex = 0; th.setAttribute("role", "button");
  const sort = () => {
    if (view.sort === th.dataset.sort) view.dir = view.dir === "asc" ? "desc" : "asc";
    else { view.sort = th.dataset.sort; view.dir = ["name", "city", "category", "rank"].includes(th.dataset.sort) ? "asc" : "desc"; }
    document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted", "asc"));
    th.classList.add("sorted"); if (view.dir === "asc") th.classList.add("asc");
    loadLeads();
  };
  th.onclick = sort;
  th.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } };
});
$("prevBtn").onclick = () => { view.page--; loadLeads(); };
$("nextBtn").onclick = () => { view.page++; loadLeads(); };

// Phone checks on demand: one business (Check / ↻) or every business in the list.
async function requestPhones(body, qs, single) {
  const url = "/api/phones/request" + (qs ? "?" + qs : "");
  const pv = await postJson(url, { ...body, dryRun: true });
  const cost = (n) => pv.maxPerCheck > 0
    ? (pv.hasFreeService ? "Usually free (the free checks are used first); at most " + money(n * pv.maxPerCheck) + "." : "About " + money(pv.maxPerCheck) + " each, up to " + money(n * pv.maxPerCheck) + ", counted toward this month’s budget.")
    : "Free.";
  if (!pv.queued) {
    if (!pv.total) return toast("There’s nothing in this list to check.");
    const parts = [];
    if (pv.checked) parts.push(num(pv.checked) + " already checked");
    if (pv.tollFree) parts.push(num(pv.tollFree) + " toll-free (known from the number)");
    if (pv.waiting) parts.push(num(pv.waiting) + " already being checked");
    if (pv.noPhone) parts.push(num(pv.noPhone) + " with no phone number on Google");
    if (pv.checked && !body.recheck) {
      if (!(await ask("These phones are all checked", "Already done: " + parts.join(", ") + ". Check the " + num(pv.checked) + " checked number" + (pv.checked > 1 ? "s" : "") + " again, for example if a business may have switched to a mobile? " + cost(pv.checked), "Check again", { paid: pv.maxPerCheck > 0 }))) return;
      return requestPhones({ ...body, recheck: true }, qs, single);
    }
    const pausedNow = phoneState && /paused|no_service/.test(phoneState.state);
    return toast(pv.waiting
      ? (pausedNow ? "These phones are waiting to be checked, but " + phoneState.message.charAt(0).toLowerCase() + phoneState.message.slice(1) + " (" + parts.join(", ") + ")."
        : "These phones are already being checked; results appear within a few minutes (" + parts.join(", ") + ").")
      : "Nothing to check: " + parts.join(", ") + ".");
  }
  if (pv.fits === false) return toast("Not enough budget left this month (" + money(pv.budgetLeft) + ") to check " + num(pv.queued) + " numbers. The owner can raise it on the Admin page (Spending).");
  if (!single) {
    const extra = [pv.checked && !body.recheck ? num(pv.checked) + " already checked" : "", pv.waiting ? num(pv.waiting) + " already waiting" : "", pv.noPhone ? num(pv.noPhone) + " have no phone" : ""].filter(Boolean);
    if (!(await ask("Check " + num(pv.queued) + " phone number" + (pv.queued > 1 ? "s" : "") + "?", "Finds out which are mobiles, landlines or internet (VoIP) numbers." + (extra.length ? " (" + extra.join(", ") + ".)" : "") + (pv.capped ? " Only the first " + num(pv.limit) + " at a time." : "") + " " + cost(pv.queued), "Check phones", { paid: pv.maxPerCheck > 0 }))) return;
  }
  await postJson(url, body);
  phonesWatched = true;
  startPolling();
  await loadLeads();
}
$("rows").addEventListener("click", async (e) => {
  const one = e.target.closest("[data-checkphone]"), again = e.target.closest("[data-recheckphone]");
  if (!one && !again) return;
  const b = one || again; b.disabled = true;
  try { await requestPhones({ ids: [one ? one.dataset.checkphone : again.dataset.recheckphone], recheck: !!again }, "", true); }
  catch (err) { toast(err.message, "bad"); b.disabled = false; }
});
$("checkPhonesBtn").onclick = async () => {
  const p = filterQuery(); p.delete("sort"); p.delete("dir");
  $("checkPhonesBtn").disabled = true;
  try { await requestPhones({}, p.toString()); } catch (err) { toast(err.message, "bad"); } finally { $("checkPhonesBtn").disabled = false; }
};

// Website check for the whole list (free; runs on the free collector, paced per day).
$("checkSitesBtn").onclick = async () => {
  const q = filterQuery(); q.delete("sort"); q.delete("dir");
  const url = "/api/websites/check?" + q.toString();
  $("checkSitesBtn").disabled = true;
  try {
    const pv = await postJson(url, { dryRun: true });
    const pace = pv.status.enabled ? "Up to " + num(pv.status.limit) + " websites are checked a day (" + num(pv.status.checkedToday) + " so far today)." : "Website checks are switched off on the Admin page.";
    if (!pv.withWebsite) return toast("No business in this list has a real website to check.");
    if (!pv.notChecked) {
      const parts = [pv.done ? num(pv.done) + " already checked" : "", pv.waiting ? num(pv.waiting) + " waiting to be checked" : ""].filter(Boolean).join(", ");
      if (pv.done && (await ask("Nothing new to check", "Already: " + parts + ". Check the " + num(pv.done) + " checked websites again? It's free. " + pace, "Check again"))) {
        const r = await postJson(url, { recheck: true });
        toast(num(r.queued) + " websites will be checked again. " + pace);
        await loadLeads();
      } else if (!pv.done) toast("Nothing new to check (" + parts + "). " + pace);
      return;
    }
    if (!(await ask("Check " + num(pv.notChecked) + " website" + (pv.notChecked > 1 ? "s" : "") + "?", "Free. " + (pv.withWebsite >= 5000 ? "The first 5,000 in this list. " : "") + pace, "Check websites"))) return;
    const r = await postJson(url, {});
    toast(num(r.queued) + " websites are queued. Results appear here as they're checked. " + pace);
    await loadLeads();
  } catch (err) { toast(err.message, "bad"); } finally { $("checkSitesBtn").disabled = false; }
};

// Paid tier: look free businesses up on Google Maps (whole list, or one row).
async function requestGoogleDetails(body, qs) {
  const url = "/api/google-details" + (qs ? "?" + qs : "");
  const pv = await postJson(url, { ...body, dryRun: true });
  if (!pv.eligible) {
    const why = [pv.alreadyGoogle ? num(pv.alreadyGoogle) + " already have Google details" : "", pv.running ? num(pv.running) + " are being looked up now" : "",
      pv.notFoundBefore ? num(pv.notFoundBefore) + " weren't found on Google before" : ""].filter(Boolean);
    if (pv.notFoundBefore && (await ask("Nothing new to look up", "Already: " + why.join(", ") + ". Try the " + num(pv.notFoundBefore) + " that weren't found on Google again? About " + money(pv.notFoundBefore * 0.005) + ".", "Try again", { paid: true }))) return requestGoogleDetails({ ...body, retryNotFound: true }, qs);
    if (!pv.notFoundBefore) toast(pv.total ? "Nothing to look up: " + why.join(", ") + "." : "There's nothing in this list.");
    return;
  }
  if (pv.budget && pv.costUsd > pv.budget.left + 1e-9) return toast("That would cost about " + money(pv.costUsd) + ", but only " + money(pv.budget.left) + " of this month's budget is left.");
  const msg = "Adds their Google rating, reviews, verified status and listing." + (pv.capped ? " The first 500 now; do the rest after." : "") + (pv.alreadyGoogle ? " " + num(pv.alreadyGoogle) + " already have Google details and are skipped." : "") + " Cost: about " + money(pv.costUsd) + ", from this month's budget.";
  if (!(await ask("Look up " + num(pv.eligible) + " business" + (pv.eligible > 1 ? "es" : "") + " on Google?", msg, "Look up · about " + money(pv.costUsd), { paid: true }))) return;
  const r = await postJson(url, body);
  tracked.add(r.search.id);
  if (currentTab === "find") { startedIds = [...new Set([...startedIds, r.search.id])]; }
  await loadPulls(); renderProgress(); startPolling(); loadSpend();
  await loadLeads();
}
$("googleDetailsBtn").onclick = async () => {
  const q = filterQuery(); q.delete("sort"); q.delete("dir");
  $("googleDetailsBtn").disabled = true;
  try { await requestGoogleDetails({}, q.toString()); } catch (err) { toast(err.message, "bad"); } finally { $("googleDetailsBtn").disabled = false; }
};
$("rows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-gdetail]"); if (!b) return;
  b.disabled = true;
  try { await requestGoogleDetails({ ids: [b.dataset.gdetail] }, ""); } catch (err) { toast(err.message, "bad"); b.disabled = false; }
});

// ---------------------------------------------------------------------------
// Working the leads: stage, assignment, notes; upload a list.
// ---------------------------------------------------------------------------
const STAGES = ["Untouched", "Contacted", "Follow-up", "Interested", "Won", "Lost"];
let team = [];
async function loadTeam2() { team = await api("/api/team").catch(() => []); }
function teamOptions(selected, withKeep) {
  return (withKeep ? '<option value="__keep">(leave as it is)</option>' : "") + '<option value="">Nobody</option><option value="me">Me</option>' +
    team.filter((t) => !me || t.id !== me.id).map((t) => '<option value="' + esc(t.id) + '"' + (t.id === selected ? " selected" : "") + ">" + esc(t.name) + "</option>").join("");
}
document.addEventListener("click", (e) => {
  const x = e.target.closest("[data-close]");
  if (x) closeModal($(x.dataset.close));
});
let openLeadId = null;
async function openLead(id) {
  openLeadId = id;
  $("ldMsg").textContent = ""; $("ldNote").value = "";
  if (!team.length) await loadTeam2();
  const d = await api("/api/leads/" + id + "/detail");
  if (openLeadId !== id) return; // another business was opened meanwhile
  const l = d.lead;
  $("ldTitle").textContent = l.business_name || "Business";
  const facts = [[l.gbp_category, l.city, l.state].filter(Boolean).join(" · "),
    l.owner_name ? "Owner: " + l.owner_name + (l.owner_title ? " (" + l.owner_title + ")" : "") + (l.owner_source === "registry" ? " · from the state registry" : " · from their website") : "",
    l.registry_name ? "Registered as: " + l.registry_name : "", l.emails ? "Email: " + l.emails : "", l.gbp_phone_formatted ? "Phone: " + phoneText(l.gbp_phone_formatted) : "",
    l.email_provider ? "Their email is with: " + l.email_provider : "", l.domain_created ? "Website address registered: " + l.domain_created.slice(0, 4) : ""].filter(Boolean);
  const company = [rangeOf(l.employees_min, l.employees_max) ? rangeOf(l.employees_min, l.employees_max) + " employees" : "",
    revenueOf(l.revenue_min, l.revenue_max) ? revenueOf(l.revenue_min, l.revenue_max) + " revenue" : "", l.founded ? "founded " + l.founded.slice(0, 4) : ""].filter(Boolean);
  if (company.length) facts.push("Company: " + company.join(" · ") + (l.size_source === "ppp" ? " (from their government loan record" + (l.size_year ? ", " + l.size_year : "") + "; revenue is an estimate)" : l.size_source === "estimate" ? " (estimated)" : ""));
  if ((l.local_labels || []).length) facts.push("Compared with similar businesses nearby: " + l.local_labels.join(", "));
  if ((d.contacts || []).length) facts.push("Contacts: " + d.contacts.map((p) => p.name + (p.title ? " (" + p.title + ")" : "")).join("; "));
  if ((d.phones || []).length) facts.push("Other phones: " + d.phones.map((p) => phoneText(p.phone)).join(", "));
  if (l.report_views) facts.push("Report opened " + l.report_views + (l.report_views === 1 ? " time" : " times") + ", last " + ago(l.report_viewed_at));
  // Score, what to fix and a suggested next step, in plain words.
  let sn = {}; try { sn = JSON.parse(l.score_notes || "{}"); } catch (e) { sn = {}; }
  const fixes = (sn.suggestions || []).slice(0, 5);
  const v = l.presence_score;
  const scoreLine = v == null ? "Not scored yet (it’s scored once the website is checked)."
    : v + " out of 100 · " + (v < 40 ? "weak online presence: lots you can help with" : v < 60 ? "basic: some things to fix" : "already strong online");
  const next = !l.lead_status || l.lead_status === "Untouched"
    ? (l.gbp_phone_formatted ? "Call " + (l.owner_name ? l.owner_name.split(" ")[0] : "them") + (fixes.length ? " and mention: " + fixes[0].toLowerCase() : "") + ". Then set the stage to Contacted." : "Send the report or the demo website, then set the stage to Contacted.")
    : l.lead_status === "Contacted" ? "No reply yet? Share the report (you’ll be told when they open it) and set the stage to Follow-up."
    : l.lead_status === "Follow-up" ? "Follow up by phone or text. Add a note with what they said."
    : l.lead_status === "Interested" ? "Send the demo website and book a call. Add a note with the date."
    : "";
  $("ldFacts").innerHTML = '<div class="ldsum">' +
    '<div class="ldbox"><b>Online score</b>' + esc(scoreLine) + (fixes.length ? "<ul>" + fixes.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + "</div>" +
    (next ? '<div class="ldbox ldnext"><b>Suggested next step</b>' + esc(next) + "</div>" : "") +
    '<div class="ldbox"><b>About them</b>' + facts.map(esc).join("<br>") + "</div></div>";
  $("ldOpen").open = false; $("ldOpeners").dataset.for = ""; $("ldOpeners").innerHTML = '<div class="hint">Loading…</div>';
  $("ldEvents").innerHTML = '<div class="hint">Loading…</div>';
  api("/api/leads/" + id + "/events").then((ev) => {
    if (openLeadId !== id) return;
    $("ldEvents").innerHTML = ev.length ? ev.map((e) => '<div class="tl">' + (EV_ICON[e.kind] || "•") + " " + esc(e.detail || e.kind) + '<div class="who">' +
      esc(e.who || (/_viewed$|^form$/.test(e.kind) ? "The business" : "Someone")) + " · " + esc(ago(e.created_at)) + "</div></div>").join("") : '<div class="hint">Nothing yet.</div>';
  }).catch((err) => { $("ldEvents").innerHTML = '<div class="err">' + esc(err.message) + "</div>"; });
  $("ldStage").innerHTML = d.stages.map((s) => '<option value="' + esc(s) + '"' + (s === (l.lead_status || "Untouched") ? " selected" : "") + ">" + esc(s) + "</option>").join("");
  $("ldAssign").innerHTML = teamOptions(l.assigned_to === (me && me.id) ? "me" : l.assigned_to);
  if (me && l.assigned_to === me.id) $("ldAssign").value = "me"; else $("ldAssign").value = l.assigned_to || "";
  $("ldNotes").innerHTML = d.notes.length ? d.notes.map((n) => '<div class="lnote"><div class="who">' + esc(n.author || "Someone") + " · " + esc(ago(n.created_at)) +
    ((me && (n.user_id === me.id || me.role !== "member")) ? ' · <button type="button" class="link small" data-del-note="' + esc(n.id) + '">delete</button>' : "") + "</div>" + esc(n.body) + "</div>").join("")
    : '<div class="hint">No notes yet.</div>';
  $("leadDialog").hidden = false;
}
async function saveLead(changes) {
  try {
    await api("/api/leads/" + openLeadId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    $("ldMsg").textContent = "Saved."; loadLeads();
    if (currentTab === "pipeline") loadPipeline();
  } catch (err) { $("ldMsg").textContent = err.message; }
}
$("ldStage").onchange = () => saveLead({ status: $("ldStage").value });
$("ldReport").onclick = async () => {
  try {
    const r = await postJson("/api/leads/" + openLeadId + "/report", {});
    try { await navigator.clipboard.writeText(r.url); $("ldMsg").textContent = "Report link copied."; } catch (e) { $("ldMsg").textContent = ""; }
    showCopy("Report link", r.url, "Anyone with this link can open the report. Send it by email or text.");
  } catch (err) { $("ldMsg").textContent = err.message; }
};
$("ldDnc").onclick = async () => {
  if (!(await ask("Put this business on the do-not-contact list?", "It will be hidden from every list and download, and so will its phone, website and emails.", "Do not contact", { danger: true }))) return;
  try { await postJson("/api/leads/" + openLeadId + "/dnc", { reason: $("ldDncReason").value }); $("leadDialog").hidden = true; loadLeads(); if (currentTab === "pipeline") loadPipeline(); }
  catch (err) { $("ldMsg").textContent = err.message; }
};
$("ldAssign").onchange = () => saveLead({ assignedTo: $("ldAssign").value || null });
$("ldAddNote").onclick = async () => {
  try { await postJson("/api/leads/" + openLeadId + "/notes", { body: $("ldNote").value }); await openLead(openLeadId); loadLeads(); }
  catch (err) { $("ldMsg").textContent = err.message; }
};
$("ldNotes").onclick = async (e) => {
  const b = e.target.closest("[data-del-note]"); if (!b || !(await ask("Delete this note?", "", "Delete", { danger: true }))) return;
  await api("/api/notes/" + b.dataset.delNote, { method: "DELETE" }).catch((err) => toast(err.message, "bad"));
  openLead(openLeadId); loadLeads();
};
$("rows").addEventListener("click", (e) => { const b = e.target.closest("[data-lead]"); if (b) openLead(b.dataset.lead).catch((err) => toast(err.message, "bad")); });
const EV_ICON = { stage: "↔", assigned: "👤", note: "📝", report_shared: "📤", report_viewed: "👀", demo_shared: "🌐", demo_viewed: "👀", dnc: "⛔", form: "📥" };
$("ldDemo").onclick = async () => {
  try {
    const r = await postJson("/api/leads/" + openLeadId + "/demo", {});
    try { await navigator.clipboard.writeText(r.url); $("ldMsg").textContent = "Demo website link copied. Anyone with it can open it."; } catch (e) { $("ldMsg").textContent = r.url; }
    window.open(r.url, "_blank", "noopener");
  } catch (err) { $("ldMsg").textContent = err.message; }
};
$("ldOpen").addEventListener("toggle", async () => {
  const id = openLeadId;
  if (!$("ldOpen").open || $("ldOpeners").dataset.for === id) return;
  try {
    const o = await api("/api/leads/" + id + "/opener");
    if (id !== openLeadId) return;
    $("ldOpeners").dataset.for = id;
    const block = (title, text) => '<div class="opener"><div class="h"><span>' + esc(title) + '</span><button type="button" class="ghost small" data-copy>Copy</button></div><pre>' + esc(text) + "</pre></div>";
    $("ldOpeners").innerHTML = block("First line (for any email)", o.firstLine) + block("Email subject", o.subject) + block("Email", o.email) +
      block("Text message", o.sms) + block("Call script", o.call) + '<div class="hint" style="margin-top:6px">The wording is set on the Admin page (Openers). Read it over and adjust before you send.</div>';
  } catch (err) { $("ldOpeners").innerHTML = '<div class="err">' + esc(err.message) + "</div>"; }
});
$("ldOpeners").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  const text = b.closest(".opener").querySelector("pre").textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); } catch (err) { showCopy("Copy this", text); }
});

// ---------------------------------------------------------------------------
// Map (Leaflet from Cloudflare's CDN, OpenStreetMap tiles), with a drawn-area filter
// ---------------------------------------------------------------------------
let leafletLoading = null, lmap = null, mapLayer = null, areaShape = null, drawLine = null, drawing = false, drawPts = [];
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((ok, fail) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = ok; js.onerror = () => { leafletLoading = null; fail(new Error("The map couldn't load. Check the internet connection and try again.")); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// The map redraws in the other colours when light / dark is switched.
document.addEventListener("themechange", () => { if (lmap && !$("mapCard").hidden) loadMap().catch(() => {}); });
const dotColor = (v) => v == null ? "#94a3b8" : v < 40 ? "#dc2626" : v < 60 ? "#d97706" : "#16a34a";
async function loadMap() {
  if ($("mapCard").hidden) return;
  await loadLeaflet();
  if (!lmap) {
    lmap = L.map("leadMap", { preferCanvas: true }).setView([27.8, -81.7], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(lmap);
    lmap.on("click", (e) => { if (!drawing) return; drawPts.push([e.latlng.lat, e.latlng.lng]); drawShape(); });
  }
  setTimeout(() => lmap.invalidateSize(), 30);
  $("mapInfo").textContent = "Loading…";
  const r = await api("/api/leads/map?" + filterQuery().toString());
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(lmap);
  const pts = [];
  for (const p of r.points) {
    L.circleMarker([p.lat, p.lng], { radius: 5, color: dotColor(p.s), fillColor: dotColor(p.s), fillOpacity: .8, weight: 1 })
      .bindPopup("<b>" + esc(p.n) + "</b><br>" + esc(p.cat || "") + "<br>Score: " + esc(p.s ?? "–") + " · " + esc(p.st) + '<br><button type="button" class="small" data-lead="' + esc(p.id) + '" style="margin-top:6px">Open</button>')
      .addTo(mapLayer);
    pts.push([p.lat, p.lng]);
  }
  if (areaShape) { areaShape.remove(); areaShape = null; }
  if (view.text.area) areaShape = L.polygon(view.text.area.split(";").map((x) => x.split(",").map(Number)), { color: cssVar("--accent"), weight: 2, fillOpacity: .05 }).addTo(lmap);
  if (areaShape) lmap.fitBounds(areaShape.getBounds(), { padding: [20, 20] });
  else if (pts.length) lmap.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
  $("mapInfo").textContent = r.points.length.toLocaleString() + " on the map" + (r.capped ? " (the 3,000 lowest scores: narrow the filters to see the rest)" : "") +
    (r.withoutPosition ? " · " + r.withoutPosition.toLocaleString() + " have no map position" : "");
  $("mapClear").hidden = !view.text.area;
}
function drawShape() {
  if (drawLine) { drawLine.remove(); drawLine = null; }
  if (drawPts.length) drawLine = L.polygon(drawPts, { color: cssVar("--accent"), weight: 2, fillOpacity: .08, dashArray: "4 4" }).addTo(lmap);
  $("mapUse").hidden = drawPts.length < 3;
}
$("leadMap").addEventListener("click", (e) => { const b = e.target.closest("[data-lead]"); if (b) openLead(b.dataset.lead).catch((err) => toast(err.message, "bad")); });
$("mapBtn").onclick = () => {
  $("mapCard").hidden = !$("mapCard").hidden;
  if (!$("mapCard").hidden) { loadMap().catch((err) => { $("mapInfo").textContent = err.message; }); $("mapCard").scrollIntoView({ behavior: "smooth", block: "start" }); }
};
$("mapClose").onclick = () => { $("mapCard").hidden = true; };
$("mapDraw").onclick = () => {
  drawing = !drawing; drawPts = []; if (lmap) drawShape();
  $("mapDraw").textContent = drawing ? "Cancel drawing" : "Draw an area";
  $("mapInfo").textContent = drawing ? "Click the map to add corners (3 or more), then press Use this area." : "";
};
$("mapUse").onclick = () => {
  view.text.area = drawPts.slice(0, 40).map((x) => x[0].toFixed(5) + "," + x[1].toFixed(5)).join(";");
  drawing = false; drawPts = []; drawShape(); $("mapDraw").textContent = "Draw an area";
  view.page = 1; refreshAll();
};
$("mapClear").onclick = () => { delete view.text.area; view.page = 1; refreshAll(); };

// ---------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------
let dragId = null, pTimer = null;
function kcard(l) {
  const v = l.presence_score;
  return '<div class="kcard" draggable="true" data-kid="' + esc(l.id) + '"><span class="sc" style="color:' + (v == null ? "var(--muted)" : v < 40 ? "var(--bad)" : v < 60 ? "var(--warn)" : "var(--ok)") + '" title="Score">' + esc(v ?? "–") + "</span><b>" +
    esc(l.business_name || "Business") + '</b><div class="sub">' + esc([l.gbp_category, l.city].filter(Boolean).join(" · ")) + "</div>" +
    (l.assigned_name ? '<div class="sub">→ ' + esc(l.assigned_name) + "</div>" : "") +
    '<select class="kstage" data-kstage="' + esc(l.id) + '" aria-label="Stage">' + STAGES.map((s) => '<option value="' + esc(s) + '"' + (s === (l.lead_status || "Untouched") ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>";
}
async function loadPipeline() {
  if (!team.length) await loadTeam2();
  if ($("pWho").options.length <= 3) team.filter((t) => !me || t.id !== me.id).forEach((t) => $("pWho").add(new Option(t.name, t.id)));
  const who = $("pWho").value, q = $("pSearch").value.trim();
  $("kanban").innerHTML = STAGES.map((st) => '<div class="kcol" data-stage="' + esc(st) + '"><h3><span>' + esc(st) + '</span><span class="muted" data-count></span></h3><div data-cards><div class="hint">Loading…</div></div></div>').join("");
  const totals = {};
  await Promise.all(STAGES.map(async (st) => {
    const p = new URLSearchParams({ lead_status: st, page_size: "50", sort: "score", dir: "asc" });
    if (who) p.set("assigned", who);
    if (q) p.set("q", q);
    const col = document.querySelector('.kcol[data-stage="' + st + '"]');
    try {
      const r = await api("/api/leads?" + p.toString());
      col.querySelector("[data-count]").textContent = r.total.toLocaleString();
      col.querySelector("[data-cards]").innerHTML = r.results.length ? r.results.map(kcard).join("") +
        (r.total > r.results.length ? '<button type="button" class="link small" data-stage-more="' + esc(st) + '">+ ' + (r.total - r.results.length).toLocaleString() + " more: see them all</button>" : "") : '<div class="hint">Nothing here.</div>';
      totals[st] = r.total;
    } catch (err) { col.querySelector("[data-cards]").innerHTML = '<div class="err">' + esc(err.message) + "</div>"; }
  }));
  const all = Object.values(totals).reduce((a, n) => a + n, 0);
  $("pMsg").innerHTML = all ? "Drag a card to change its stage. Best prospects (lowest scores) first."
    : who === "me" ? 'Nothing assigned to you yet (Database → Assign). <button type="button" class="link" id="pEveryone">Show everyone’s</button>'
    : "Nothing here yet. Businesses appear once they’re assigned or their stage changes (Database → Assign).";
  if ($("pEveryone")) $("pEveryone").onclick = () => { $("pWho").value = ""; loadPipeline(); };
}
$("kanban").addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-kstage]"); if (!sel) return;
  try { await api("/api/leads/" + sel.dataset.kstage, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: sel.value }) }); toast("Moved to " + sel.value + ".", "ok"); }
  catch (err) { toast(err.message, "bad"); }
  loadPipeline();
});
$("kanban").addEventListener("click", (e) => {
  const m = e.target.closest("[data-stage-more]"); if (!m) return;
  e.stopPropagation();
  const who = $("pWho").value;
  setTab("database");
  restore({ ...defaultFilters, scope: null, label: "" });
  f.leadStatus.set([m.dataset.stageMore]);
  if (who) f.assigned.set([who]);
  reload();
}, true);
$("kanban").addEventListener("dragstart", (e) => {
  const c = e.target.closest(".kcard"); if (!c) return;
  dragId = c.dataset.kid; e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move";
});
$("kanban").addEventListener("dragover", (e) => {
  const col = e.target.closest(".kcol"); if (!col || !dragId) return;
  e.preventDefault();
  document.querySelectorAll(".kcol.over").forEach((x) => { if (x !== col) x.classList.remove("over"); });
  col.classList.add("over");
});
$("kanban").addEventListener("dragleave", (e) => { const col = e.target.closest(".kcol"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("over"); });
$("kanban").addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".kcol.over").forEach((x) => x.classList.remove("over")); });
$("kanban").addEventListener("drop", async (e) => {
  const col = e.target.closest(".kcol"); if (!col || !dragId) return;
  e.preventDefault(); col.classList.remove("over");
  const id = dragId; dragId = null;
  const card = document.querySelector('.kcard[data-kid="' + id + '"]');
  if (!card || card.closest(".kcol") === col) return;
  col.querySelector("[data-cards]").prepend(card);
  try {
    await api("/api/leads/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: col.dataset.stage }) });
    $("pMsg").textContent = "Moved to " + col.dataset.stage + ".";
  } catch (err) { $("pMsg").textContent = err.message; }
  loadPipeline();
});
$("kanban").addEventListener("click", (e) => { if (e.target.closest("select")) return; const c = e.target.closest(".kcard"); if (c) openLead(c.dataset.kid).catch((err) => toast(err.message, "bad")); });
$("pWho").onchange = () => loadPipeline();
$("pSearch").oninput = () => { clearTimeout(pTimer); pTimer = setTimeout(loadPipeline, 350); };

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
async function loadOverview() {
  const o = await api("/api/overview");
  const t = o.totals || {}, n = (v) => Number(v || 0).toLocaleString(), pct = (v) => (t.total ? Math.round((100 * Number(v || 0)) / t.total) + "%" : "–");
  const stat = (big, label) => '<div class="stat"><b>' + esc(big) + "</b><span>" + esc(label) + "</span></div>";
  $("ovStats").innerHTML = [stat(n(t.total), "businesses (not counting do-not-contact)"), stat("+" + n(t.week), "added in the last 7 days"),
    stat(pct(t.owners), "with an owner's name (" + n(t.owners) + ")"), stat(pct(t.emails), "with an email (" + n(t.emails) + ")"),
    stat(n(t.verified), "with a verified email"), stat(pct(t.phones), "with a phone (" + n(t.mobiles) + " mobiles)"),
    stat(pct(t.websites), "with a website"), stat(n(t.weak), "weak online presence (score under 40)"),
    stat(n(t.reports_shared), "reports shared · " + n(t.reports_opened) + " opened"), stat(n(t.demos_shared), "demo websites made"),
    stat(n(t.assigned), "assigned to someone")].join("");
  const stageN = Object.fromEntries(o.stages.map((x) => [x.stage, x.n])), max = Math.max(1, ...o.stages.map((x) => x.n));
  $("ovStages").innerHTML = STAGES.map((st) => '<div class="hbar"><button type="button" class="link" data-ov-stage="' + esc(st) + '">' + esc(st) + '</button><i style="width:' + Math.max(1, Math.round((100 * (stageN[st] || 0)) / max)) + '%"></i><span class="muted">' + n(stageN[st]) + "</span></div>").join("");
  const gmax = Math.max(1, ...o.growth.map((g) => g.n));
  $("ovGrowth").innerHTML = o.growth.map((g) => '<div title="' + esc(g.day + ": " + g.n.toLocaleString()) + '" style="height:' + Math.round((100 * g.n) / gmax) + '%"></div>').join("");
  $("ovGrowthHint").textContent = o.growth[0].day + " to " + o.growth[o.growth.length - 1].day + " · " + n(o.growth.reduce((a, g) => a + g.n, 0)) + " added";
  $("ovReps").innerHTML = o.reps.map((r) => "<tr><td>" + esc(r.name) + "</td><td>" + n(r.total) + "</td><td>" + n(r.untouched) + "</td><td>" + n(r.working) + "</td><td>" + n(r.interested) + "</td><td>" + n(r.won) + "</td></tr>").join("");
  $("ovHot").innerHTML = o.hot.length ? o.hot.map((h) => '<div class="tl"><button type="button" class="link" data-lead="' + esc(h.id) + '">' + esc(h.business_name || "Business") + '</button> <span class="muted">' +
    esc([[h.city, h.state].filter(Boolean).join(", "), h.lead_status || "Untouched", h.rep].filter(Boolean).join(" · ")) + '</span><div class="who">Opened ' + esc(ago(h.report_viewed_at)) + " · " +
    n(h.report_views) + (h.report_views === 1 ? " view" : " views") + "</div></div>").join("")
    : '<div class="hint">No report opened yet. Share one from a business’s pop-up; you’re told when they open it.</div>';
}
$("ovStages").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ov-stage]"); if (!b) return;
  setTab("database");
  restore({ ...defaultFilters, scope: null, label: "" });
  f.leadStatus.set([b.dataset.ovStage]);
  reload();
});
$("ovHot").addEventListener("click", (e) => { const b = e.target.closest("[data-lead]"); if (b) openLead(b.dataset.lead).catch((err) => toast(err.message, "bad")); });

// ---------------------------------------------------------------------------
// Admin: opener wording, website form
// ---------------------------------------------------------------------------
let opDefaults = null;
function fillOp(t) { $("opSubject").value = t.subject; $("opEmail").value = t.email; $("opSms").value = t.sms; $("opCall").value = t.call; }
async function loadOpenersAdmin() {
  const r = await api("/api/openers/templates").catch((err) => cardFail("openersCard", err, loadOpenersAdmin)); if (!r) return;
  opDefaults = r.defaults;
  $("opFields").textContent = r.fields.map((x) => "{" + x + "}").join(" ");
  fillOp(r.templates);
}
$("opSave").onclick = async () => {
  try {
    await api("/api/openers/templates", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: $("opSubject").value, email: $("opEmail").value, sms: $("opSms").value, call: $("opCall").value }) });
    $("opMsg").textContent = "Saved.";
  } catch (err) { $("opMsg").textContent = err.message; }
};
$("opReset").onclick = () => { if (opDefaults) { fillOp(opDefaults); $("opMsg").textContent = "The defaults are filled in: press Save to keep them."; } };
async function loadFormAdmin() {
  const r = await api("/api/form").catch(() => null);
  $("formCard").hidden = !r; if (!r) return;
  $("formLink").href = r.url; $("formLink").textContent = r.url; $("formEmbed").value = r.embed;
}
$("formCopy").onclick = async () => { try { await navigator.clipboard.writeText($("formEmbed").value); $("formMsg").textContent = "Copied."; } catch (e) { $("formEmbed").select(); } };
$("formNew").onclick = async () => {
  if (!(await ask("Make a new form link?", "The form on your website stops working until you paste the new code there.", "Make a new link", { danger: true }))) return;
  try { await postJson("/api/form/new-link", {}); await loadFormAdmin(); $("formMsg").textContent = "New link made. Update your website with the new code."; } catch (err) { $("formMsg").textContent = err.message; }
};

// Admin: online store (settings, customers, credits).
let storeAccounts = [];
const STORE_STATUS = { pending: ["warn", "Waiting for approval"], active: ["ok", "Active"], suspended: ["bad", "Paused"] };
async function loadStoreAdmin() {
  const s = await api("/api/store/settings").catch(() => null);
  $("storeCard").hidden = !s; if (!s) return;
  $("stPriceFree").value = s.priceFree; $("stPriceGoogle").value = s.priceGoogle; $("stWelcome").value = s.welcomeCredits;
  $("stBrand").value = s.brandName; $("stColor").value = s.brandColor; $("stSupport").value = s.supportEmail;
  $("stUrl").value = s.storeUrl; $("stLogo").value = s.logoUrl || ""; $("stSignup").checked = !!s.signupOpen;
  $("stSignupMode").value = s.signupMode === "approval" ? "approval" : "open"; $("stFreeMonth").value = s.freePerMonth; $("stPublic").checked = !!s.publicPages;
  $("stCreditPrice").value = s.creditPrice == null ? "" : String(s.creditPrice);
  $("stOpen").hidden = !isWebLink(s.storeUrl); if (isWebLink(s.storeUrl)) $("stOpen").href = s.storeUrl;
  await Promise.all([loadStoreCustomers(), loadStoreRemovals().catch(() => {}), loadLaunch().catch((err) => cardFail("storeCard", err, loadStoreAdmin))]);
}
// Getting the store ready to sell: the checklist, credit packs, the email sender, card sales.
function packRow(p) {
  return '<div class="line packrow"><label class="muted"><input type="number" class="pkC" min="1" step="1" value="' + esc(p ? p.credits : "") + '" style="width:100px" aria-label="Credits"> credits for $ ' +
    '<input type="number" class="pkP" min="0.5" step="0.01" value="' + esc(p ? p.price : "") + '" style="width:100px" aria-label="Price in dollars"></label> <span class="hint pkEach"></span>' +
    ' <button type="button" class="link small" data-pack-del>Remove</button></div>';
}
function packEach() {
  document.querySelectorAll("#packRows .packrow").forEach((r) => {
    const c = Number(r.querySelector(".pkC").value), p = Number(r.querySelector(".pkP").value);
    r.querySelector(".pkEach").textContent = c > 0 && p > 0 ? "= " + money(p / c) + " per credit" : "";
  });
}
async function loadLaunch() {
  const d = await api("/api/store/launch");
  const done = d.items.filter((i) => i.done && i.required).length, need = d.items.filter((i) => i.required).length;
  $("launchSummary").className = "pill " + (d.ready ? "ok" : "warn");
  $("launchSummary").textContent = d.ready ? "Ready to launch ✓" : done + " of " + need + " done";
  $("launchList").innerHTML = d.items.map((i) => '<li class="' + (i.done ? "done" : "") + '"><span class="ck">' + (i.done ? "✓" : "") + "</span><div><b>" + esc(i.label) + "</b>" +
    (i.required ? "" : ' <span class="muted">(optional)</span>') + (i.done ? "" : '<div class="hint">' + esc(i.how) + "</div>") + "</div></li>").join("");
  $("launchNote").textContent = "Card payments, emails and the spam check show as done once their keys are added and someone opens the store" +
    (d.features.checkedAt ? " (last checked " + ago(d.features.checkedAt.replace("T", " ").slice(0, 19)) + ")." : ".");
  $("packRows").innerHTML = (d.settings.packs.length ? d.settings.packs : [null]).map(packRow).join("");
  packEach();
  if (document.activeElement !== $("lsFrom")) $("lsFrom").value = d.settings.emailFrom || "";
  $("lsLegal").checked = !!d.settings.legalReviewed; $("lsPaid").checked = !!d.settings.paidPlan;
  const r = d.revenue;
  $("revenueLine").textContent = r.payments ? "Card sales: " + money(r.total) + " in total, " + money(r.last30) + " in the last 30 days (" + num(r.payments) + " payments). Latest: " +
    r.recent.slice(0, 3).map((x) => x.company + " " + money(x.amount)).join(", ") + "." : "No card sales yet.";
}
$("packRows").addEventListener("input", packEach);
$("packRows").addEventListener("click", (e) => { const b = e.target.closest("[data-pack-del]"); if (b) { b.closest(".packrow").remove(); packEach(); } });
$("packAdd").onclick = () => { if (document.querySelectorAll("#packRows .packrow").length >= 6) return toast("Up to 6 packs.", "bad"); $("packRows").insertAdjacentHTML("beforeend", packRow(null)); };
$("lsSave").onclick = async () => {
  const packs = [...document.querySelectorAll("#packRows .packrow")].map((r) => ({ credits: r.querySelector(".pkC").value.trim(), price: r.querySelector(".pkP").value.trim() }))
    .filter((p) => p.credits || p.price).map((p) => ({ credits: Number(p.credits), price: Number(p.price) }));
  $("lsMsg").className = "hint"; $("lsMsg").textContent = "Saving…";
  try {
    await api("/api/store/launch", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ packs, emailFrom: $("lsFrom").value, legalReviewed: $("lsLegal").checked, paidPlan: $("lsPaid").checked }) });
    $("lsMsg").textContent = "Saved."; loadLaunch().catch(() => {});
  } catch (err) { $("lsMsg").className = "hint err"; $("lsMsg").textContent = err.message; }
};
let storeRemovals = [];
const REMOVAL_STATUS = { new: ["warn", "New"], done: ["ok", "Removed"], dismissed: ["", "Dismissed"] };
async function loadStoreRemovals() {
  const list = await api("/api/store/removals");
  storeRemovals = list;
  const fresh = list.filter((r) => r.status === "new").length;
  for (const id of ["stRemBadge", "stRemCount", "navStoreBadge"]) { $(id).hidden = !fresh; $(id).textContent = num(fresh) + " new removal request" + (fresh === 1 ? "" : "s"); }
  $("stRemRows").innerHTML = list.length ? list.map((r) => {
    const [cls, label] = REMOVAL_STATUS[r.status] || ["", r.status];
    const contact = [r.phone, r.website, r.email].filter(Boolean).map((v) => esc(v)).join("<br>") || '<span class="muted">none given</span>';
    const from = [r.name, r.contactEmail].filter(Boolean).map((v) => esc(v)).join("<br>") || '<span class="muted">not given</span>';
    const acts = r.status === "new" ? '<button type="button" data-rm="suppress">Remove from everything</button> <button type="button" class="ghost" data-rm="dismiss">Dismiss</button>' : "";
    return '<tr data-rem="' + esc(r.id) + '"><td class="nowrap">' + esc(ago(r.createdAt)) + "</td><td>" + esc(r.business) + "</td><td>" + contact + "</td><td>" + from +
      "</td><td>" + (r.message ? esc(r.message) : '<span class="muted">none</span>') + '</td><td><span class="pill ' + esc(cls) + '">' + esc(label) + '</span></td><td class="nowrap">' + acts + "</td></tr>";
  }).join("") : '<tr><td colspan="7" class="muted">No removal requests. When a business owner asks to be taken out on your public website, it shows up here.</td></tr>';
}
$("stRemRows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rm]"), row = e.target.closest("[data-rem]");
  if (!b || !row) return;
  const r = storeRemovals.find((x) => String(x.id) === row.dataset.rem); if (!r) return;
  const action = b.dataset.rm;
  if (action === "suppress" && !(await ask("Remove " + r.business + " from everything?", "Their phone, website and email go on your do-not-contact list, so they're hidden from your lists, downloads and the store.", "Remove from everything", { danger: true }))) return;
  try {
    await postJson("/api/store/removals/" + encodeURIComponent(r.id), { action });
    await loadStoreRemovals();
  } catch (err) { toast(err.message, "bad"); }
});
async function loadStoreCustomers() {
  const [accounts, st] = await Promise.all([api("/api/store/accounts"), api("/api/store/stats").catch(() => null)]);
  storeAccounts = accounts;
  if (st) {
    const week = st.byDay.slice(-7).reduce((a, d) => a + d.leads, 0);
    $("stStats").textContent = num(st.accounts.active) + " active customers" + (st.accounts.pending ? " · " + num(st.accounts.pending) + " waiting for approval" : "") +
      (st.accounts.suspended ? " · " + num(st.accounts.suspended) + " paused" : "") + " · " + num(st.leadsSold) + " leads sold (" + num(week) + " in the last 7 days) · " +
      num(st.creditsSpent) + " credits spent · " + num(st.creditsGranted) + " credits given";
  }
  $("stRows").innerHTML = accounts.length ? accounts.map((a) => {
    const [cls, label] = STORE_STATUS[a.status] || ["", a.status];
    const people = a.users.map((u) => esc(u.name || "") + (u.name ? ' <span class="muted">' + esc(u.email) + "</span>" : esc(u.email))).join("<br>");
    const acts = (a.status === "pending" ? '<button type="button" data-st="approve">Approve</button>' : a.status === "active" ? '<button type="button" class="ghost" data-st="pause">Pause</button>' : '<button type="button" class="ghost" data-st="reactivate">Reactivate</button>') +
      ' <button type="button" class="ghost" data-st="credits">Add credits</button>' + (a.users.length ? ' <button type="button" class="ghost" data-st="password">Reset password</button>' : "");
    return '<tr data-acct="' + esc(a.id) + '"><td>' + esc(a.company) + '<div class="muted small">signed up ' + esc(ago(a.createdAt)) + "</div></td><td>" + (people || '<span class="muted">none</span>') +
      '</td><td><span class="pill ' + esc(cls) + '">' + esc(label) + "</span></td><td>" + esc(num(a.credits)) + "</td><td>" + esc(num(a.freeUsed || 0)) + "</td><td>" + esc(num(a.leadsBought)) + "</td><td>" + esc(num(a.creditsSpent)) +
      "</td><td>" + (a.lastPurchaseAt ? esc(ago(a.lastPurchaseAt)) : '<span class="muted">never</span>') + '</td><td class="nowrap">' + acts + "</td></tr>";
  }).join("") : '<tr><td colspan="9" class="muted">No customers yet. When a company signs up in your store, it appears here for you to approve.</td></tr>';
}
$("stSave").onclick = async () => {
  try {
    await api("/api/store/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
      priceFree: Number($("stPriceFree").value), priceGoogle: Number($("stPriceGoogle").value), welcomeCredits: Number($("stWelcome").value || 0),
      brandName: $("stBrand").value, brandColor: $("stColor").value, supportEmail: $("stSupport").value, storeUrl: $("stUrl").value, logoUrl: $("stLogo").value, signupOpen: $("stSignup").checked,
      signupMode: $("stSignupMode").value, freePerMonth: Number($("stFreeMonth").value || 0), publicPages: $("stPublic").checked,
      creditPrice: $("stCreditPrice").value.trim() === "" ? null : Number($("stCreditPrice").value),
    }) });
    $("stMsg").textContent = "Saved.";
    loadStoreAdmin().catch(() => {});
  } catch (err) { $("stMsg").textContent = err.message; }
};
$("stRows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-st]"), row = e.target.closest("[data-acct]");
  if (!b || !row) return;
  const a = storeAccounts.find((x) => x.id === row.dataset.acct); if (!a) return;
  const base = "/api/store/accounts/" + encodeURIComponent(a.id);
  try {
    const act = b.dataset.st;
    if (act === "approve" || act === "reactivate") {
      const r = await postJson(base + "/status", { status: "active" });
      if (r.welcomeGiven) toast(a.company + " is approved and got " + num(r.welcomeGiven) + " welcome credits.");
    } else if (act === "pause") {
      if (!(await ask("Pause " + a.company + "?", "They can still sign in and download what they unlocked, but can't unlock more.", "Pause", { danger: true }))) return;
      await postJson(base + "/status", { status: "suspended" });
    } else if (act === "credits") {
      const v = await uiForm({ title: "Credits for " + a.company, text: "They have " + num(a.credits) + " credits now.", ok: "Save",
        fields: [{ id: "delta", label: "Credits to add (a minus sign takes some away, e.g. -10)", type: "number" },
          { id: "note", label: "Note for the history (optional)", placeholder: "Paid $100 by bank transfer" }],
        validate: (x) => { const d = Number(String(x.delta).replace(/,/g, "")); return Number.isInteger(d) && d !== 0 ? "" : "Type a whole number, like 100 or -10."; } });
      if (!v) return;
      const r = await postJson(base + "/credits", { delta: Number(String(v.delta).replace(/,/g, "")), note: v.note });
      toast(a.company + " now has " + num(r.balance) + " credits.", "ok");
    } else if (act === "password") {
      let email = a.users[0].email;
      if (a.users.length > 1) {
        const v = await uiForm({ title: "Reset whose password?", ok: "Next", fields: [{ id: "who", label: "Person", type: "select", value: a.users[0].email, options: a.users.map((u) => [u.email, (u.name ? u.name + " · " : "") + u.email]) }] });
        if (!v) return;
        email = v.who;
      }
      if (!(await ask("Give " + email + " a new temporary password?", "They'll be signed out and asked to choose their own password when they sign in.", "Reset password", { danger: true }))) return;
      const r = await postJson(base + "/reset-password", { email });
      await showCopy("Temporary password for " + email, r.password, "Copy it now and send it to them. It isn't shown again.");
    }
    await loadStoreCustomers();
  } catch (err) { toast(err.message, "bad"); }
});

// The whole filtered list: stage and / or assignment.
let bulkCount = 0;
$("bulkBtn").onclick = async () => {
  if (!team.length) await loadTeam2();
  const q = filterQuery(); q.delete("sort"); q.delete("dir");
  const pv = await postJson("/api/leads/bulk?" + q, { dryRun: true }).catch((err) => { toast(err.message, "bad"); return null; });
  if (!pv) return;
  bulkCount = pv.count;
  $("bkCount").innerHTML = "Changes <b>all " + num(pv.count) + "</b>" + (pv.capped ? " (the first 5,000)" : "") + " in this list, not just this page." +
    (pv.count > 200 ? " You can undo it straight after." : "");
  $("bkSave").textContent = "Update " + num(pv.count) + " business" + (pv.count === 1 ? "" : "es");
  $("bkStage").innerHTML = '<option value="">(leave as it is)</option>' + STAGES.map((s) => '<option value="' + esc(s) + '">' + esc(s) + "</option>").join("");
  $("bkAssign").innerHTML = teamOptions(null, true);
  $("bkMsg").textContent = "";
  $("bulkDialog").hidden = false;
};
$("bkSave").onclick = async () => {
  const q = filterQuery(); q.delete("sort"); q.delete("dir");
  const b = {};
  if ($("bkStage").value) b.status = $("bkStage").value;
  if ($("bkAssign").value !== "__keep") b.assignedTo = $("bkAssign").value || null;
  if (!("status" in b) && !("assignedTo" in b)) { $("bkMsg").textContent = "Pick a stage or a person."; return; }
  if (bulkCount > 200 && !(await uiForm({ title: "Change " + num(bulkCount) + " businesses?", text: "That's a lot at once. To be sure, type the number.", confirmWord: String(bulkCount), ok: "Update " + num(bulkCount), paid: true }))) return;
  try {
    const r = await postJson("/api/leads/bulk?" + q, b);
    $("bulkDialog").hidden = true; loadLeads();
    toast("Updated " + num(r.updated) + " businesses.", "ok", r.previous && r.previous.length ? { label: "Undo", run: async () => {
      try { const u = await postJson("/api/leads/bulk/undo", { previous: r.previous }); toast("Undone: " + num(u.restored) + " businesses are back as they were.", "ok"); loadLeads(); if (currentTab === "pipeline") loadPipeline(); }
      catch (err) { toast(err.message, "bad"); }
    } } : null);
  }
  catch (err) { $("bkMsg").textContent = err.message; }
};

// Plain-English search: the AI sets the filter chips (and exact review / rating limits).
async function runAiSearch() {
  const text = $("aiText").value.trim();
  if (!text) return;
  $("aiGo").disabled = true; $("aiMsg").className = "hint"; $("aiMsg").textContent = "Reading…";
  try {
    const r = await postJson("/api/ai-search", { text });
    const p = r.params;
    const arr = (k) => (Array.isArray(p[k]) ? p[k] : p[k] ? [p[k]] : []);
    restore({ ...defaultFilters, scope: view.scope, label: view.scopeLabel });
    f.category.set(arr("category")); f.state.set(arr("state")); f.city.set(arr("city"));
    const one = (dd, key) => { if (p[key]) dd.set([p[key]]); };
    one(f.website, "website"); one(f.phone, "phone"); one(f.email, "email"); one(f.owner, "owner"); one(f.chain, "chain");
    f.phoneType.set(arr("phone_type")); f.score.set(arr("score")); f.siteCheck.set(arr("site_check")); f.siteProblem.set(arr("site_problem"));
    f.ads.set(arr("ads")); f.builder.set(arr("builder"));
    const ai = {};
    for (const k of ["min_reviews", "max_reviews", "min_rating", "max_rating"]) if (p[k]) ai[k] = p[k];
    view.text.ai = Object.keys(ai).length ? ai : null;
    if (p.near) { view.text.near = p.near; view.text.radius = p.radius_miles; }
    if (p.added_from) view.text.addedFrom = p.added_from;
    if (p.q) { view.text.q = p.q; $("nameSearch").value = p.q; }
    Object.values(f).forEach((d) => d.renderChip());
    const extra = view.text.ai ? " Also: " + Object.entries(view.text.ai).map(([k, v]) => k.replace("_", " ") + " " + v).join(", ") + '. <button type="button" class="link small" id="aiClearExtra">remove</button>' : "";
    $("aiMsg").innerHTML = "✓ " + esc(r.summary) + extra + (r.notUnderstood ? ' <span class="bad-text">' + esc(r.notUnderstood) + "</span>" : "");
    if ($("aiClearExtra")) $("aiClearExtra").onclick = () => { view.text.ai = null; $("aiMsg").textContent = ""; reload(); };
    reload(); loadSpend();
  } catch (err) { $("aiMsg").className = "hint err"; $("aiMsg").textContent = err.message; }
  finally { $("aiGo").disabled = false; }
}
$("aiGo").onclick = runAiSearch;
$("aiText").onkeydown = (e) => { if (e.key === "Enter") runAiSearch(); };

// Email verification (MillionVerifier) for the best email of each business in the list.
$("verifyBtn").onclick = async () => {
  const q = filterQuery(); q.delete("sort"); q.delete("dir");
  const url = "/api/emails/verify?" + q.toString();
  $("verifyBtn").disabled = true;
  try {
    const pv = await postJson(url, { dryRun: true });
    if (!pv.withEmail) return toast("No business in this list has an email address.");
    if (!pv.toCheck) return toast("All " + num(pv.withEmail) + " emails here are already verified (or being checked). Nothing to pay for.");
    if (pv.credits != null && pv.credits < pv.toCheck && !(await ask("Not enough checks left", "Only " + num(pv.credits) + " email checks are left for " + num(pv.toCheck) + " emails; the rest will wait until the plan is topped up.", "Continue", { paid: true }))) return;
    if (!(await ask("Verify " + num(pv.toCheck) + " email" + (pv.toCheck > 1 ? "s" : "") + "?", "Checks that each address really exists, so your emails don't bounce." + (pv.alreadyChecked ? " " + num(pv.alreadyChecked) + " already verified are skipped." : "") + " About $0.001-0.0025 each" + (pv.credits != null ? " (" + num(pv.credits) + " checks left on the plan)." : "."), "Verify emails", { paid: true }))) return;
    const r = await postJson(url, {});
    toast(num(r.queued) + " emails are being verified (about 20 a minute). Results show next to each email, and downloads leave out ones that would bounce.");
    loadLeads();
  } catch (err) { toast(err.message, "bad"); } finally { $("verifyBtn").disabled = false; }
};

// Upload a list (CSV).
$("uploadBtn").onclick = () => { $("upMsg").textContent = ""; $("upFile").value = ""; $("upPreview").hidden = true; $("upSave").disabled = true; $("upSave").textContent = "Upload"; $("uploadDialog").hidden = false; };
const UP_WORDS = { name: "Business name", website: "Website", phone: "Phone", email: "Email", address: "Address", city: "City", state: "State", zip: "ZIP", category: "Type of business" };
$("upFile").onchange = async () => {
  const file = $("upFile").files && $("upFile").files[0];
  $("upPreview").hidden = true; $("upSave").disabled = true; $("upMsg").className = "hint"; $("upMsg").textContent = "";
  if (!file) return;
  if (file.size > 3000000) { $("upMsg").className = "hint err"; $("upMsg").textContent = "That file is too big (up to about 3 MB). Split it into smaller files."; return; }
  $("upMsg").textContent = "Reading the file…";
  try {
    const r = await postJson("/api/uploads", { csv: await file.text(), preview: true });
    const found = Object.keys(UP_WORDS).filter((k) => r.columns[k]);
    const missing = Object.keys(UP_WORDS).filter((k) => !r.columns[k]);
    $("upPreview").innerHTML = "<b>Looks good</b>" + num(r.rows) + " businesses found" + (r.skipped ? " (" + num(r.skipped) + " rows without a business name are skipped)" : "") + ".<br>" +
      "Columns we’ll use: " + found.map((k) => "✓ " + esc(UP_WORDS[k]) + ' <span class="muted">(“' + esc(r.columns[k]) + "”)</span>").join(", ") +
      (missing.length ? '<br><span class="muted">Not in the file: ' + esc(missing.map((k) => UP_WORDS[k]).join(", ")) + "</span>" : "") +
      (r.sample.length ? '<br><span class="muted">First: ' + esc(r.sample.map((x) => [x.name, x.city].filter(Boolean).join(", ")).join(" · ")) + "</span>" : "");
    $("upPreview").hidden = false; $("upSave").disabled = false; $("upMsg").textContent = "";
    $("upSave").textContent = "Add " + num(r.rows) + " businesses";
  } catch (err) { $("upMsg").className = "hint err"; $("upMsg").textContent = err.message; }
};
$("upSave").onclick = async () => {
  const file = $("upFile").files && $("upFile").files[0];
  if (!file) { $("upMsg").textContent = "Choose a CSV file first."; return; }
  $("upMsg").className = "hint";
  if (file.size > 3000000) { $("upMsg").textContent = "That file is too big (up to about 3 MB). Split it into smaller files."; return; }
  $("upSave").disabled = true; $("upMsg").textContent = "Uploading…";
  try {
    const r = await postJson("/api/uploads", { name: $("upName").value || file.name.replace(/\\.[^.]+$/, ""), csv: await file.text() });
    $("uploadDialog").hidden = true;
    toast("Saved " + num(r.rows) + " businesses: " + num(r.added) + " new" + (r.matched ? ", " + num(r.matched) + " you already had" : "") + (r.skipped ? " (" + num(r.skipped) + " rows had no business name)" : "") +
      ". Their websites are checked and scored over the next hours.");
    await loadPulls();
    useScope([r.searchId], r.name);
  } catch (err) { $("upMsg").textContent = err.message; } finally { $("upSave").disabled = false; }
};

// Every business matching the current filters (all pages, same order as the table), in the GHL upload format.
$("downloadBtn").onclick = async () => {
  const btn = $("downloadBtn"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const q = filterQuery(); q.set("format", $("exportFormat").value);
    const res = await fetch("/api/export?" + q);
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "The download failed (" + res.status + ")."); }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || "leads.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast("Downloaded. Businesses on the do-not-contact list and emails that would bounce are left out.", "ok");
  } catch (err) { toast(err.message, "bad"); }
  finally { btn.disabled = false; btn.textContent = label; }
};

// Menus in the results bar (Improve these leads, Columns): one open at a time.
function menuToggle(btn, menu, onOpen) {
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll(".actmenu").forEach((m) => { m.hidden = true; });
    menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open && onOpen) onOpen();
  };
}
menuToggle($("improveBtn"), $("improveMenu"));
$("improveMenu").addEventListener("click", (e) => { if (e.target.closest("button")) $("improveMenu").hidden = true; });
document.addEventListener("click", (e) => { if (!e.target.closest(".actmenu")) document.querySelectorAll(".actmenu").forEach((m) => { m.hidden = true; }); });

// Columns: pick which to show (remembered on this computer). Fewer columns = no sideways scrolling.
const COLS = [...document.querySelectorAll("#resultsCard thead th")].map((th) => th.textContent.trim());
let hiddenCols = new Set(mem.get("hiddenCols", ["Neighborhood", "Location", "Position"]));
function applyCols() {
  let st = $("colStyle");
  if (!st) { st = document.createElement("style"); st.id = "colStyle"; document.head.appendChild(st); }
  st.textContent = COLS.map((name, i) => hiddenCols.has(name) ? "#resultsCard thead th:nth-child(" + (i + 1) + "), #rows td:nth-child(" + (i + 1) + ") { display: none; }" : "").join(" ");
}
function renderCols() {
  $("colsMenu").innerHTML = '<div class="mhead">Columns to show (remembered on this computer)</div>' + COLS.map((name) => '<label><input type="checkbox" data-col="' + esc(name) + '"' +
    (hiddenCols.has(name) ? "" : " checked") + (name === "Business" ? " disabled" : "") + "> " + esc(name) + "</label>").join("") +
    '<button type="button" class="link small" data-col-reset style="margin:6px 10px">Back to the usual columns</button>';
}
menuToggle($("colsBtn"), $("colsMenu"), renderCols);
$("colsMenu").addEventListener("change", (e) => {
  const c = e.target.dataset.col; if (!c) return;
  if (e.target.checked) hiddenCols.delete(c); else hiddenCols.add(c);
  mem.set("hiddenCols", [...hiddenCols]); applyCols();
});
$("colsMenu").addEventListener("click", (e) => {
  if (!e.target.closest("[data-col-reset]")) return;
  hiddenCols = new Set(["Neighborhood", "Location", "Position"]); mem.set("hiddenCols", [...hiddenCols]); applyCols(); renderCols();
});
applyCols();
// The download format is remembered too.
$("exportFormat").value = mem.get("exportFormat", "ghl");
$("exportFormat").onchange = () => mem.set("exportFormat", $("exportFormat").value);
// ---------------------------------------------------------------------------
// Searches: light polling (only the searches this page follows) + history
// ---------------------------------------------------------------------------
let polling = null;
const tracked = new Set(); // searches this page follows: started here, or still running when it opened
async function loadPulls() {
  if (!tracked.size) { pulls = []; return pulls; }
  const p = new URLSearchParams({ limit: "200" });
  [...tracked].forEach((id) => p.append("id", id));
  pulls = await api("/api/searches?" + p);
  return pulls;
}
let pollBusy = false, phoneState = null, phonesWatched = false, lastResultsRefresh = 0;
async function pollActive() {
  if (pollBusy || document.hidden) return; // nothing to update while the tab isn't visible
  pollBusy = true;
  try {
    const before = pulls.filter((s) => RUNNING.includes(s.status)).length;
    await loadPulls();
    renderProgress();
    const running = pulls.filter((s) => RUNNING.includes(s.status)).length;
    const finishedNow = before > running;
    if (phonesWatched) {
      phoneState = await api("/api/phones/status").catch(() => phoneState);
      if (phoneState && (!phoneState.pending || /paused|no_service/.test(phoneState.state))) phonesWatched = false;
    }
    if (!running && !phonesWatched && polling) { clearInterval(polling); polling = null; }
    // The list is refreshed every 30 s while things run, and straight away when something finishes.
    if (!$("resultsBody").hidden && (finishedNow || !polling || Date.now() - lastResultsRefresh > 30000)) {
      lastResultsRefresh = Date.now();
      if (finishedNow || !polling) await refreshAll(); else await loadLeads();
    }
    if (!$("historyView").hidden && (finishedNow || !polling)) loadHistory();
  } finally { pollBusy = false; }
}
function startPolling() { if (!polling) polling = setInterval(pollActive, 10000); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && polling) pollActive(); });

function historyQuery() {
  const p = new URLSearchParams();
  const map = { hCategory: "category", hCity: "city", hState: "state", hStatus: "status", hFrom: "from", hTo: "to" };
  for (const [id, key] of Object.entries(map)) if ($(id).value.trim()) p.set(key, $(id).value.trim());
  return p;
}
const historySelection = new Set();
let historyRowsData = [], historyLimit = 100;
async function loadHistory() {
  const q = historyQuery(); q.set("limit", String(historyLimit));
  const rows = await api("/api/searches?" + q);
  historyRowsData = rows;
  $("historyCount").textContent = rows.length ? num(rows.length) + " search" + (rows.length === 1 ? "" : "es") + " shown" : "";
  $("historyMore").hidden = rows.length < historyLimit;
  $("historyRows").innerHTML = rows.length ? rows.map((s) => {
    const stopped = !!s.cancelled_at && s.status === "done";
    const label = stopped ? "Stopped" : PULL_LABELS[s.status] || s.status;
    const cls = s.status === "failed" ? "bad" : stopped ? "warn" : s.status === "done" ? "ok" : "warn";
    const biz = s.status === "done" && !s.leads_in_database && !stopped ? '<span class="muted">none on Google here</span>'
      : s.leads_in_database ? num(s.leads_in_database) + (s.new_leads_count != null && s.new_leads_count !== s.leads_in_database ? ' <span class="muted">(' + num(s.new_leads_count) + " new)</span>" : "") : '<span class="muted">—</span>';
    const finished = s.status === "done" || s.status === "failed";
    const spent = (s.cost_apify || 0) + (s.cost_twilio || 0);
    const cost = s.source === "free" ? '<span class="muted">free</span>' : finished ? (spent ? money(spent) : '<span class="muted">no charge</span>') : s.estimated_cost != null ? "~" + money(s.estimated_cost) : "";
    const test = (s.apify_actor_id === "dataforseo-test" && me && me.role !== "member" ? ' <span class="pill">test</span>' : "") + (s.source === "free" ? ' <span class="pill free">free data</span>' : s.source === "google_details" ? ' <span class="pill">paid lookup</span>' : "");
    const note = s.error || "";
    return '<tr><td><input type="checkbox" aria-label="Pick this search" data-pick="' + esc(s.id) + '"' + (historySelection.has(s.id) ? " checked" : "") + "></td>" +
      "<td>" + esc(ago(s.created_at)) + "</td><td>" + esc(s.category) + test + "</td><td>" + esc(placeLabel(s)) + "</td>" +
      '<td><span class="pill ' + cls + '">' + esc(label) + "</span></td><td>" + biz + "</td><td>" + cost + "</td>" +
      '<td class="acts"><button class="ghost small" type="button" data-view="' + esc(s.id) + '">Open list</button>' +
      (s.status === "failed" && s.apify_run_id ? ' <button class="ghost small" type="button" data-resume="' + esc(s.id) + '" title="Carries on saving what was collected. Does not pay again.">Resume</button>' : "") +
      ((s.status === "pending" || s.status === "scraping") && !s.cancelled_at ? ' <button class="ghost small danger" type="button" data-cancel="' + esc(s.id) + '" title="Stops collecting. What it already collected is kept.">Stop</button>' : "") + "</td></tr>" +
      (note ? '<tr class="noterow"><td></td><td colspan="7" class="hint ' + (s.status === "failed" ? "err" : "") + '">' + esc(note) + "</td></tr>" : "");
  }).join("")
    : '<tr><td colspan="8" class="empty-state">No searches match.</td></tr>';
}
$("historyMore").onclick = () => { historyLimit = Math.min(500, historyLimit + 100); loadHistory(); };$("historyRows").onclick = async (e) => {
  if (await pullAction(e, loadHistory)) return;
  const v = e.target.closest("[data-view]");
  if (v) { const p = historyRowsData.find((x) => x.id === v.dataset.view); showPulls([v.dataset.view], p ? p.category + " in " + placeLabel(p) : ""); return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { pick.checked ? historySelection.add(pick.dataset.pick) : historySelection.delete(pick.dataset.pick); $("hViewSelected").disabled = !historySelection.size; }
};
$("hViewSelected").onclick = () => showPulls([...historySelection], historySelection.size + " searches");
let hTyping;
["hCategory", "hCity", "hState"].forEach((id) => $(id).oninput = () => { clearTimeout(hTyping); hTyping = setTimeout(() => { historyLimit = 100; loadHistory(); }, 300); });
["hStatus", "hFrom", "hTo"].forEach((id) => $(id).onchange = () => { historyLimit = 100; loadHistory(); });
function showPulls(ids, label) {
  setTab("find");
  // Everything from those searches, including not-verified and closed (the header says so),
  // starting from clean filters so nothing from an earlier list carries over.
  restore({ ...defaultFilters, scope: null, label: "" });
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
/** After a search, the empty list says where the businesses will appear instead of repeating the instructions. */
function emptyAfterSearch() { $("emptyMsg").textContent = "Your businesses show here once you press the button above."; $("examples").hidden = true; }
function setTab(tab) {
  if (currentTab === "find" || currentTab === "database") tabState[currentTab] = snapshot();
  currentTab = tab;
  $("mapCard").hidden = true; drawing = false; drawPts = []; $("mapDraw").textContent = "Draw an area";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("findView").hidden = ["history", "team", "activity", "pipeline", "overview"].includes(tab);
  $("pipelineView").hidden = tab !== "pipeline";
  $("overviewView").hidden = tab !== "overview";
  $("activityView").hidden = tab !== "activity";
  $("historyView").hidden = tab !== "history";
  $("teamView").hidden = tab !== "team";
  const failed = (rows, cols) => (err) => { $(rows).innerHTML = '<tr><td colspan="' + cols + '" class="err">' + esc(err.message) + "</td></tr>"; };
  if (tab === "history") { loadHistory().catch(failed("historyRows", 8)); return; }
  if (tab === "team") { loadTeam().catch(failed("teamRows", 6)); return; }
  if (tab === "activity") { adminSec(mem.get("adminSec", "spend")); loadSpend(); loadActivity().catch(failed("activityRows", 4)); loadBackups(); loadFree(); loadOpenersAdmin(); loadFormAdmin(); loadStoreAdmin().catch(() => {}); return; }
  if (tab === "pipeline") { loadPipeline().catch((err) => { $("pMsg").textContent = err.message; }); return; }
  if (tab === "overview") { loadOverview().catch((err) => { $("ovStats").innerHTML = '<div class="err">' + esc(err.message) + "</div>"; }); return; }
  // Both tabs share the search row: Find leads collects, Database filters what's collected.
  const db = tab === "database";
  $("findView").classList.toggle("dbmode", db);
  acWhat.reset(); acWhere.reset(); setFindMsg("");
  $("savedCard").hidden = db || !savedList.length;
  if (!db) renderProgress(); else $("progress").hidden = true;
  $("pageTitle").textContent = db ? "Database" : "Find leads";
  $("pageSub").textContent = db ? "Everything collected. Filter it, then download." : "Search by type and place. You see the count and any cost first.";
  $("plan").hidden = db || !lastRequest;
  const saved = tabState[tab] || defaultFilters;
  restore(saved);
  acWhat.render(); acWhere.render(); updateFindLabel();
  if (db) useScope(null, "");
  else if (saved.shown) useScope(saved.scope, saved.label);
  else { $("emptyState").hidden = false; $("resultsBody").hidden = true; $("filtersCard").hidden = true; }
}
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));
function adminSec(sec) {
  document.querySelectorAll("#activityView [data-sec]").forEach((el) => {
    if (el.tagName === "BUTTON") el.classList.toggle("active", el.dataset.sec === sec);
    else el.classList.toggle("secoff", el.dataset.sec !== sec);
  });
  mem.set("adminSec", sec);
}
$("adminNav").onclick = (e) => { const b = e.target.closest("[data-sec]"); if (b) adminSec(b.dataset.sec); };
/** A card whose information couldn't load says so, with Try again (instead of staying empty). */
function cardFail(id, err, retry) {
  const card = $(id); if (!card) return null;
  let el = card.querySelector(".cardfail");
  if (!el) { el = document.createElement("div"); el.className = "callout warn cardfail"; const h = card.querySelector("h2"); if (h) h.after(el); else card.prepend(el); }
  el.innerHTML = "Couldn’t load this part: " + esc(err.message) + ' <button type="button" class="link">Try again</button>';
  el.querySelector("button").onclick = () => { el.remove(); retry(); };
  return null;
}
let defaultFilters = null;

// ---------------------------------------------------------------------------
// Signed-in user + Team (admins)
// ---------------------------------------------------------------------------
let me = null;
async function loadMe() {
  me = await api("/api/me");
  const initials = (me.name || "?").split(/ +/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  $("me").innerHTML = '<span class="avatar">' + esc(initials) + '</span><span class="mename">' + esc(me.name || "Account") + "</span>";
  $("acctWho").innerHTML = esc(me.name || "") + "<br>" + (me.role === "super_admin" ? "Owner" : me.role === "admin" ? "Admin" : "Team member");
  $("roleLabel").textContent = me.role === "super_admin" ? "Owner" : me.role === "admin" ? "Admin" : "Team";
  $("teamTab").hidden = me.role !== "admin" && me.role !== "super_admin";
  $("activityTab").hidden = me.role !== "super_admin";
  $("budgetSave").disabled = me.role !== "super_admin";
}
$("signOut").onclick = async () => { await postJson("/api/auth/logout", {}).catch(() => {}); location.href = "/login"; };
$("changePw").onclick = () => { $("acctMenu").hidden = true; ["pwCurrent", "pwNew", "pwNew2"].forEach((id) => $(id).value = ""); $("pwMsg").textContent = ""; $("pwDialog").hidden = false; $("pwCurrent").focus(); };
$("acctBtn").onclick = (e) => { e.stopPropagation(); const open = $("acctMenu").hidden; $("acctMenu").hidden = !open; $("acctBtn").setAttribute("aria-expanded", String(open)); };
document.addEventListener("click", (e) => { if (!e.target.closest("#acctMenu, #acctBtn")) { $("acctMenu").hidden = true; $("acctBtn").setAttribute("aria-expanded", "false"); } });
$("limitClose").onclick = () => { $("limitBanner").hidden = true; };
// Change password: an in-page form (the passwords stay hidden while typing).
const closePw = () => { $("pwDialog").hidden = true; };
$("pwClose").onclick = closePw; $("pwCancel").onclick = closePw;
$("pwSave").onclick = async () => {
  const current = $("pwCurrent").value, next = $("pwNew").value;
  const say = (t, bad) => { $("pwMsg").className = bad ? "hint err" : "hint"; $("pwMsg").textContent = t; };
  if (!current || !next) return say("Fill in your current and new password.", true);
  if (next.length < 10) return say("The new password needs at least 10 characters.", true);
  if (next !== $("pwNew2").value) return say("The two new passwords don't match.", true);
  $("pwSave").disabled = true; say("Saving…");
  try { await postJson("/api/me/password", { current, next }); say("Password changed. Other devices were signed out."); setTimeout(closePw, 1500); }
  catch (err) { say(err.message, true); }
  finally { $("pwSave").disabled = false; }
};
/** "2026-09-25 18:02:11" (UTC) -> local date and time. */
function fmtTime(ts) { return ts ? new Date(ts.replace(" ", "T") + "Z").toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; }
function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}
async function loadTeam() {
  if (!$("tPassword").value) $("tPassword").value = tempPassword();
  const users = await api("/api/admin/users");
  $("teamRows").innerHTML = users.map((u) => "<tr><td>" + esc(u.name || "") + "</td><td>" + esc(u.email) + "</td><td>" + (u.role === "super_admin" ? "Owner" : u.role === "admin" ? "Admin" : "Member") +
    "</td><td>" + (u.active ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Switched off</span>') + (u.must_change_password ? ' <span class="pill warn">temporary password</span>' : "") +
    "</td><td>" + esc(u.last_login_at ? fmtTime(u.last_login_at) : "never") + "</td><td>" +
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
    if (!/^[^ @]+@[^ @]+[.][^ @]+$/.test(email)) throw new Error("That email doesn't look right. Check it and try again.");
    await postJson("/api/admin/users", { email, name: $("tName").value.trim(), password, role: $("tRole").value });
    const who = $("tName").value.trim() || email;
    $("tMsg").textContent = "Added " + who + ".";
    $("tEmail").value = ""; $("tName").value = ""; $("tPassword").value = tempPassword();
    showCopy("Send this to " + who, "Sign in at " + location.origin + " · Email: " + email + " · Temporary password: " + password, "They choose their own password the first time they sign in. This isn't shown again.");
    loadTeam();
  } catch (err) { $("tMsg").className = "hint err"; $("tMsg").textContent = err.message; }
};
$("teamRows").onclick = async (e) => {
  const b = e.target.closest("[data-uact]"); if (!b) return;
  const id = b.dataset.uid, act = b.dataset.uact;
  let changes;
  if (act === "reset") {
    const pw = tempPassword();
    if (!(await ask("Reset this person's password?", "They get a new temporary password, are signed out, and choose their own when they sign in.", "Reset password", { danger: true }))) return;
    changes = { password: pw };
  } else if (act === "off" || act === "on") changes = { active: act === "on" };
  else changes = { role: act };
  try {
    await api("/api/admin/users/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    if (changes.password) await showCopy("New temporary password", changes.password, "Send it to them. They choose their own password when they sign in.");
    loadTeam();
  } catch (err) { toast(err.message, "bad"); }
};

// ---------------------------------------------------------------------------
// Notifications (bell + Pull history), spend this month, Activity log + budget (super admin)
// ---------------------------------------------------------------------------
const ACTION_LABELS = {
  signed_in: "Signed in", signed_out: "Signed out", sign_in_failed: "Failed sign-in", password_changed: "Changed password",
  team_member_added: "Added a team member", team_member_changed: "Changed a team member", pull_started: "Started collecting",
  counts_checked: "Checked how many exist", phone_checks_started: "Started phone checks", csv_downloaded: "Downloaded a CSV",
  notification_dismissed: "Dismissed a notification", maintenance_backfill: "Ran maintenance",
  pull_cancelled: "Stopped a search", pull_resumed: "Resumed a search", phone_checks_requested: "Asked for phone checks", google_details_started: "Asked for Google details", harvest_added: "Added to the daily free collection",
  api_key_created: "Made a connection key", dnc_added: "Added to do-not-contact", dnc_removed: "Took off do-not-contact", emails_verification_started: "Started email checks",
  form_link_changed: "Made a new website form link", leads_updated: "Changed stage / assignment", list_uploaded: "Uploaded a list", opener_templates_changed: "Changed the opener wording",
  saved_search_added: "Saved a search", saved_search_deleted: "Deleted a saved search", score_weights_changed: "Changed the score weights",
  store_account_status: "Changed a store customer", store_credits_changed: "Changed a customer’s credits", store_password_reset: "Reset a customer’s password",
  store_removal_request: "Handled a removal request", store_settings_changed: "Changed store settings", website_check_settings: "Changed website check settings",
  website_check_started: "Started website checks",
};
const FILTER_WORDS = { state: "state", city: "city", category: "type", industry: "industry", min_rating: "rating at least", max_rating: "rating at most", min_reviews: "reviews at least",
  max_reviews: "reviews at most", lead_status: "stage", assigned: "assigned to", phone_type: "phone type", website: "website", email: "email", score: "score", q: "name contains",
  status: "open / closed", verified: "verified", data_source: "data", added_from: "added from", added_to: "added to", near: "near", radius_miles: "miles", area: "drawn area" };
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
  if ($("budgetNow")) $("budgetNow").textContent = "Spent this month: " + money(spend.spent) + " (collecting " + money(spend.pulls) + ", phone checks " + money(spend.phones) +
    ", counts " + money(spend.counts) + "), " + money(spend.left) + " left.";
  if ($("budgetInput") && document.activeElement !== $("budgetInput")) $("budgetInput").value = spend.budget;
}
$("budgetSave").onclick = async () => {
  $("budgetMsg").className = "hint"; $("budgetMsg").textContent = "Saving…";
  const raw = $("budgetInput").value.trim();
  if (raw === "" || !Number.isFinite(Number(raw))) { $("budgetMsg").className = "hint err"; $("budgetMsg").textContent = "Type an amount in dollars, e.g. 25."; return; }
  if (Number(raw) === 0 && !(await ask("Set the limit to $0?", "Every Google search, count and paid phone check will be refused until it's raised. Free data still works.", "Set to $0", { danger: true }))) { $("budgetMsg").textContent = ""; return; }
  try { await api("/api/budget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: Number(raw) }) }); $("budgetMsg").textContent = "Saved."; loadSpend(); }
  catch (err) { $("budgetMsg").className = "hint err"; $("budgetMsg").textContent = err.message; }
};

const size = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
async function loadBackups() {
  const data = await api("/api/admin/backups").catch((err) => cardFail("backupCard", err, loadBackups));
  if (!data) return;
  $("backupRun").disabled = !data.enabled;
  $("backupHint").textContent = data.enabled
    ? "A copy of everything (businesses, searches, settings) is saved every night at about 3 am New York time and kept for " + data.keep + " nights. If something goes wrong, download one and send the file to your developer."
    : data.paused ? "Backups will start once the test data is wiped and the app goes into production." : "";
  const last = data.backups.find((b) => b.status === "done");
  $("backupNow").innerHTML = data.paused ? '<span class="pill warn">Paused</span> Backups are paused until production (test data is wiped first).'
    : !data.enabled ? '<span class="pill warn">Off</span> Backups are switched off. Ask your developer to switch on backup storage.'
    : last ? "Last good backup: " + esc(ago(last.finished_at)) + "." : "No backup yet. The first one runs tonight.";
  $("backupRows").innerHTML = data.backups.length ? data.backups.map((b) => "<tr><td>" + esc(b.id) + "</td><td>" +
    '<span class="pill ' + (b.status === "done" ? "ok" : b.status === "failed" ? "bad" : "warn") + '" title="' + esc(b.error || "") + '">' + esc(b.status === "running" ? "copying…" : b.status) + "</span></td><td>" +
    Number(b.rows_copied || 0).toLocaleString() + "</td><td>" + (b.bytes ? size(b.bytes) : "") + "</td><td>" +
    (b.status === "done" ? '<a class="small" href="/api/admin/backups/' + encodeURIComponent(b.id) + '/sql">Download</a>' : "") + "</td></tr>").join("")
    : '<tr><td colspan="5" class="muted">No backups yet.</td></tr>';
}
$("backupRun").onclick = async () => {
  $("backupMsg").className = "hint"; $("backupMsg").textContent = "Starting…";
  try { await postJson("/api/admin/backups/run", {}); $("backupMsg").textContent = "Started. It carries on in the background and usually takes a few minutes."; loadBackups(); }
  catch (err) { $("backupMsg").className = "hint err"; $("backupMsg").textContent = err.message; }
};

async function loadHarvest() {
  const h = await api("/api/harvest").catch(() => null);
  if (!h) { $("harvestRows").innerHTML = '<tr><td colspan="3" class="muted">Only admins can see this list.</td></tr>'; return; }
  if (document.activeElement !== $("harvestTarget")) $("harvestTarget").value = h.target;
  $("harvestOn").checked = h.enabled;
  $("harvestOn").disabled = $("harvestSave").disabled = me.role !== "super_admin";
  $("harvestNow").innerHTML = (h.enabled ? '<span class="pill ok">On</span> ' : '<span class="pill">Off</span> ') +
    num(h.items.length) + " on the list · " + num(h.due) + " due now" + (h.enabled ? "" : " (switch it on after go-live)");
  $("harvestRows").innerHTML = h.items.length ? h.items.map((i) => "<tr><td>" + esc(i.label) + "</td><td>" +
    (i.last_collected_at ? esc(ago(i.last_collected_at)) + (i.last_status && i.last_status !== "done" ? ' <span class="muted">(' + esc(i.last_status) + ")</span>" : "") : '<span class="muted">not yet</span>') +
    '</td><td><button type="button" class="link small" data-harvest-remove="' + esc(i.id) + '">Remove</button></td></tr>').join("")
    : '<tr><td colspan="3" class="muted">Nothing on the list yet.</td></tr>';
}
$("harvestRows").onclick = async (e) => {
  const b = e.target.closest("[data-harvest-remove]"); if (!b) return;
  await api("/api/harvest/" + b.dataset.harvestRemove, { method: "DELETE" }).catch((err) => toast(err.message, "bad"));
  loadHarvest();
};
$("harvestSave").onclick = async () => {
  $("harvestMsg").className = "hint"; $("harvestMsg").textContent = "Saving…";
  try {
    await api("/api/harvest/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: $("harvestOn").checked, target: Number($("harvestTarget").value) }) });
    $("harvestMsg").textContent = "Saved."; loadHarvest(); loadFree();
  } catch (err) { $("harvestMsg").className = "hint err"; $("harvestMsg").textContent = err.message; }
};
async function loadSites() {
  const s = await api("/api/websites/status").catch((err) => cardFail("sitesCard", err, loadSites));
  if (!s) return;
  const seenMin = s.checkerSeenAt ? (Date.now() - new Date(s.checkerSeenAt.replace(" ", "T") + "Z")) / 60000 : null;
  $("sitesNow").innerHTML = (s.enabled ? '<span class="pill ok">On</span> ' : '<span class="pill">Off</span> ') +
    num(s.done) + " checked in total · " + num(s.checkedToday) + " today (limit " + num(s.limit) + ") · " + num(s.queued + s.checking) + " waiting" +
    (s.checkerSeenAt ? " · the checker last ran " + esc(ago(s.checkerSeenAt)) : "") +
    (seenMin != null && seenMin > 60 && s.queued ? ' <span class="pill warn">the website checker hasn’t run for over an hour</span>' : "") +
    (s.speedKey ? ' · <span class="pill ok">speed check on</span>' : ' · <span class="pill">speed check off (needs the free Google speed key)</span>');
  if (document.activeElement !== $("sitesLimit")) $("sitesLimit").value = s.limit;
  $("sitesOn").checked = s.enabled;
  $("sitesOn").disabled = $("sitesSave").disabled = me.role !== "super_admin";
  // Email verification.
  const ev = await api("/api/emails/status").catch(() => null);
  if (ev) {
    $("sitesNow").innerHTML += '<div style="margin-top:6px">Email verification: ' + (ev.enabled ? '<span class="pill ok">on</span>' : '<span class="pill">off (needs the email-checking service key)</span>') +
      " · " + num(ev.ok) + " valid, " + num(ev.risky) + " risky, " + num(ev.bad) + " bounce" + (ev.queued ? " · " + num(ev.queued) + " waiting" : "") +
      (ev.credits != null ? " · " + num(ev.credits) + " credits left" : "") + (ev.problem ? ' <span class="pill bad" title="' + esc(ev.problem) + '">problem: ' + esc(ev.problem) + "</span>" : "") + "</div>";
  }
  // Owners from state registries.
  const reg = await api("/api/registry/status").catch(() => null);
  if (reg) {
    $("sitesNow").innerHTML += '<div style="margin-top:6px">Owner names known: <b>' + num(reg.ownersKnown) + "</b>" +
      (reg.states.length ? " · state registries: " + reg.states.map((s) => esc(s.state) + " " + num(s.checked) + "/" + num(s.total) + " looked up, " + num(s.from_registry) + " owners").join("; ") : "") +
      (reg.floridaLastRun ? " · Florida file last read " + esc(ago(reg.floridaLastRun)) : "") +
      (reg.lastError ? ' <span class="pill warn" title="' + esc(reg.lastError.message) + '">last problem ' + esc(ago(reg.lastError.at)) + "</span>" : "") + "</div>";
  }
}
$("sitesSave").onclick = async () => {
  $("sitesMsg").className = "hint"; $("sitesMsg").textContent = "Saving…";
  try {
    await api("/api/websites/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: $("sitesOn").checked, limit: Number($("sitesLimit").value) }) });
    $("sitesMsg").textContent = "Saved."; loadSites();
  } catch (err) { $("sitesMsg").className = "hint err"; $("sitesMsg").textContent = err.message; }
};
async function loadApi() {
  const keys = await api("/api/admin/api-keys").catch((err) => cardFail("apiCard", err, loadApi));
  if (!keys) return;
  $("keyRows").innerHTML = keys.length ? keys.map((k) => "<tr><td>" + esc(k.name) + ' <span class="muted">' + esc(k.prefix) + "…</span>" + (k.revoked_at ? ' <span class="pill bad">revoked</span>' : "") +
    "</td><td>" + (k.can_collect ? "yes" : "no") + "</td><td>" + (k.last_used_at ? esc(ago(k.last_used_at)) : '<span class="muted">never</span>') + "</td><td>" +
    (k.revoked_at ? "" : '<button type="button" class="link small" data-revoke="' + esc(k.id) + '">Revoke</button>') + "</td></tr>").join("")
    : '<tr><td colspan="4" class="muted">No keys yet.</td></tr>';
  const h = await api("/api/admin/webhooks").catch(() => null);
  if (!h) return;
  $("hookRows").innerHTML = h.webhooks.length ? h.webhooks.map((w) => "<tr><td>" + esc(w.url) + "</td><td>" + esc(String(w.events).replace(/,/g, ", ")) + "</td><td>" +
    (w.last_sent_at ? esc(ago(w.last_sent_at)) : "") + (w.last_status ? ' <span class="muted">(' + esc(w.last_status) + ")</span>" : "") + (w.waiting ? " · " + num(w.waiting) + " waiting" : "") + "</td><td>" +
    '<button type="button" class="link small" data-hook-test="' + esc(w.id) + '">Test</button> <button type="button" class="link small" data-hook-del="' + esc(w.id) + '">Delete</button></td></tr>').join("")
    : '<tr><td colspan="4" class="muted">No webhooks yet.</td></tr>';
}
$("keyAdd").onclick = async () => {
  try {
    const r = await postJson("/api/admin/api-keys", { name: $("keyName").value, canCollect: $("keyCollect").checked });
    $("keyName").value = ""; loadApi();
    showCopy("Your new connection key", r.key, "Copy it now: it isn't shown again. Paste it into the other tool (developers: send it as the Authorization header, Bearer key).");
  } catch (err) { $("keyMsg").textContent = err.message; }
};
$("keyRows").onclick = async (e) => {
  const b = e.target.closest("[data-revoke]"); if (!b || !(await ask("Turn this key off?", "Tools using it stop working at once.", "Turn off", { danger: true }))) return;
  await api("/api/admin/api-keys/" + b.dataset.revoke, { method: "DELETE" }).catch((err) => toast(err.message, "bad")); loadApi();
};
$("hookAdd").onclick = async () => {
  try {
    const events = [...document.querySelectorAll(".hookEv")].filter((x) => x.checked).map((x) => x.value);
    const r = await postJson("/api/admin/webhooks", { url: $("hookUrl").value, events });
    $("hookUrl").value = ""; loadApi();
    showCopy("Secret for this connection", r.secret, "Copy it now: it isn't shown again. Your developer uses it to check that calls really come from Lead Finder.");
  } catch (err) { $("hookMsg").textContent = err.message; }
};
$("hookRows").onclick = async (e) => {
  const t = e.target.closest("[data-hook-test]"), d = e.target.closest("[data-hook-del]");
  if (t) { const r = await postJson("/api/admin/webhooks/" + t.dataset.hookTest + "/test", {}).catch((err) => ({ note: err.message })); toast(r.note); setTimeout(loadApi, 70000); }
  if (d && (await ask("Delete this connection?", "", "Delete", { danger: true }))) { await api("/api/admin/webhooks/" + d.dataset.hookDel, { method: "DELETE" }).catch((err) => toast(err.message, "bad")); loadApi(); }
};
const WEIGHT_LABELS = {
  website: { loads: "Website loads", https: "Secure (https)", mobile: "Works on phones", form: "Contact form", booking: "Online booking", pixel: "Meta pixel", gtag: "Google tag", speed: "Speed (needs the Google key)" },
  gbp: { verified: "Google profile verified", phone: "Phone on Google", website: "Website on Google", hours: "Opening hours", description: "Description", photos: "Photos", reviews: "Number of reviews", rating: "Star rating", features: "Features listed" },
};
let weightDefaults = null;
function renderWeights(w) {
  const group = (key, title) => '<div style="margin-top:6px"><b>' + title + '</b><div class="line" style="flex-wrap:wrap">' +
    Object.entries(WEIGHT_LABELS[key]).map(([k, label]) => '<label class="muted">' + esc(label) + ' <input type="number" min="0" max="50" step="1" data-w="' + key + "." + k + '" value="' + esc(w[key][k]) + '" style="width:64px"></label>').join("") + "</div></div>";
  $("weightsForm").innerHTML = group("website", "Website") + group("gbp", "Google profile") +
    '<div style="margin-top:6px"><label class="muted">Overall score: website share <input type="number" min="0" max="100" step="5" id="wShare" value="' + esc(w.websiteShare) + '" style="width:64px"> % (the rest is the Google profile, when we have it)</label></div>';
  const su = !me || me.role !== "super_admin";
  document.querySelectorAll("#weightsForm input").forEach((i) => i.disabled = su);
  $("weightsSave").disabled = $("weightsReset").disabled = su;
}
async function loadWeightsUi() {
  const r = await api("/api/scoring/weights").catch((err) => cardFail("weightsCard", err, loadWeightsUi));
  if (!r) return;
  weightDefaults = r.defaults;
  renderWeights(r.weights);
}
async function saveWeightsUi(w) {
  $("weightsMsg").textContent = "Saving…";
  try {
    const r = await api("/api/scoring/weights", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(w) });
    renderWeights(r.weights); $("weightsMsg").textContent = r.note;
  } catch (err) { $("weightsMsg").textContent = err.message; }
}
$("weightsSave").onclick = () => {
  const w = { website: {}, gbp: {}, websiteShare: Number($("wShare").value) };
  document.querySelectorAll("#weightsForm [data-w]").forEach((i) => { const [g, k] = i.dataset.w.split("."); w[g][k] = Number(i.value); });
  saveWeightsUi(w);
};
$("weightsReset").onclick = async () => { if (weightDefaults && (await ask("Back to the default weights?", "Every weight goes back to the default and all businesses are scored again.", "Use the defaults"))) saveWeightsUi(weightDefaults); };
async function loadAgency() {
  const a = await api("/api/agency").catch((err) => cardFail("agencyCard", err, loadAgency));
  if (!a) return;
  $("agName").value = a.name; $("agPhone").value = a.phone; $("agEmail").value = a.email; $("agSite").value = a.website; $("agBlurb").value = a.blurb;
}
$("agSave").onclick = async () => {
  try {
    await api("/api/agency", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("agName").value, phone: $("agPhone").value, email: $("agEmail").value, website: $("agSite").value, blurb: $("agBlurb").value }) });
    $("agMsg").textContent = "Saved."; loadAgency();
  } catch (err) { $("agMsg").textContent = err.message; }
};
let dncTyping;
async function loadDnc() {
  const d = await api("/api/dnc?search=" + encodeURIComponent($("dncSearch").value || "")).catch((err) => cardFail("dncCard", err, loadDnc));
  if (!d) return;
  $("dncCount").textContent = num(d.total) + " entries · " + num(d.businessesHidden) + " businesses hidden";
  $("dncRows").innerHTML = d.results.length ? d.results.map((r) => "<tr><td>" + esc(r.value) + ' <span class="muted">(' + esc(r.kind) + ")</span>" + (r.note ? '<div class="cellnote muted">' + esc(r.note) + "</div>" : "") +
    "</td><td>" + esc(d.reasons[r.reason] || r.reason) + "</td><td>" + esc(ago(r.created_at)) + (r.added_by ? ' <span class="muted">by ' + esc(r.added_by) + "</span>" : "") + "</td><td>" +
    (me && me.role !== "member" ? '<button type="button" class="link small" data-dnc-del="' + esc(r.id) + '">Remove</button>' : "") + "</td></tr>").join("")
    : '<tr><td colspan="4" class="muted">Nothing on the list' + ($("dncSearch").value ? " matches" : " yet") + ".</td></tr>";
}
$("dncAdd").onclick = async () => {
  $("dncMsg").textContent = "Adding…";
  try {
    const r = await postJson("/api/dnc", { text: $("dncText").value, reason: $("dncReason").value, note: $("dncNote").value });
    $("dncMsg").textContent = "Added " + num(r.added) + " (" + num(r.phones) + " phones, " + num(r.emails) + " emails, " + num(r.domains) + " websites). " + num(r.businessesHidden) + " businesses are hidden now.";
    $("dncText").value = ""; loadDnc();
  } catch (err) { $("dncMsg").textContent = err.message; }
};
$("dncSearch").oninput = () => { clearTimeout(dncTyping); dncTyping = setTimeout(loadDnc, 300); };
$("dncRows").onclick = async (e) => {
  const b = e.target.closest("[data-dnc-del]"); if (!b || !(await ask("Take this off the do-not-contact list?", "Matching businesses show in lists and downloads again.", "Take it off", { danger: true }))) return;
  await api("/api/dnc/" + b.dataset.dncDel, { method: "DELETE" }).catch((err) => toast(err.message, "bad")); loadDnc();
};
async function loadFree() {
  loadAgency();
  loadDnc();
  loadHarvest();
  loadSites();
  loadApi();
  loadWeightsUi();
  const d = await api("/api/free/status").catch((err) => cardFail("freeCard", err, loadFree));
  if (!d) return;
  const seenMin = d.collectorSeenAt ? (Date.now() - new Date(d.collectorSeenAt.replace(" ", "T") + "Z")) / 60000 : null;
  $("freeNow").innerHTML = (seenMin != null && seenMin < 30 ? '<span class="pill ok">Collector checked in ' + esc(ago(d.collectorSeenAt)) + "</span> "
      : '<span class="pill warn">' + (d.collectorSeenAt ? "Collector last checked in " + esc(ago(d.collectorSeenAt)) : "Collector hasn't checked in yet") + "</span> ") +
    num(d.savedToday) + " saved today" + (d.leftToday != null ? " · " + num(d.leftToday) + " more allowed today" : "") + (d.waiting ? " · " + num(d.waiting) + " waiting to be saved" : "");
  if (document.activeElement !== $("freeLimit")) $("freeLimit").value = d.limit;
  $("freeLimitSave").disabled = me.role !== "super_admin";
  $("freeRows").innerHTML = d.imports.length ? d.imports.map((i) => "<tr><td>" + esc(ago(i.created_at)) + (i.release ? ' <span class="muted">(data ' + esc(i.release.slice(0, 10)) + ")</span>" : "") + "</td><td>" +
    '<span class="pill ' + (i.status === "done" ? "ok" : i.status === "failed" ? "bad" : "warn") + '" title="' + esc(i.error || "") + '">' +
    esc({ queued: "waiting for collector", claimed: "starting", collecting: "collecting", received: "saving", done: "done", failed: "failed" }[i.status] || i.status) + "</span></td><td>" + num(i.rows_received) + "</td><td>" +
    (i.status === "failed" ? '<button type="button" class="ghost small" data-dispatch="' + esc(i.id) + '">Try again</button>' : "") + "</td></tr>" +
    (i.error ? '<tr class="noterow"><td colspan="4" class="hint">' + esc(i.error) + "</td></tr>" : "")).join("")
    : '<tr><td colspan="4" class="muted">No free collections yet.</td></tr>';
}
$("freeRows").onclick = async (e) => {
  const b = e.target.closest("[data-dispatch]"); if (!b) return;
  b.disabled = true;
  try { const r = await postJson("/api/free/imports/" + b.dataset.dispatch + "/dispatch", {}); toast(r.ok ? (r.note || "Queued.") : r.error); } catch (err) { toast(err.message, "bad"); }
  loadFree();
};
$("freeLimitSave").onclick = async () => {
  $("freeMsg").className = "hint"; $("freeMsg").textContent = "Saving…";
  try { await api("/api/free/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyLimit: Number($("freeLimit").value) }) }); $("freeMsg").textContent = "Saved."; loadFree(); }
  catch (err) { $("freeMsg").className = "hint err"; $("freeMsg").textContent = err.message; }
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
  if (d.undo) parts.push("undo");
  if (d.passwordReset) parts.push("password reset");
  if (d.reason) parts.push(d.reason);
  if (d.count != null) parts.push(num(d.count) + " number" + (d.count === 1 ? "" : "s"));
  if (d.recheck) parts.push("checked again");
  if (d.maxCostUsd != null) parts.push("up to " + money(d.maxCostUsd));
  if (d.filters) {
    const fl = Object.entries(d.filters).filter(([k]) => !["page", "sort", "dir", "search_id"].includes(k));
    const scoped = d.filters.search_id ? String(d.filters.search_id).split(", ").length : 0;
    parts.push((scoped ? "from " + scoped + " search" + (scoped > 1 ? "es" : "") + "; " : "") + (fl.length ? fl.map(([k, v]) => (FILTER_WORDS[k] || k.replace(/_/g, " ")) + ": " + (k === "area" ? "yes" : v)).join("; ") : "all businesses"));
  }
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
  $("activityRows").innerHTML = data.results.length ? data.results.map((r) => "<tr><td>" + esc(fmtTime(r.at)) + "</td><td>" + esc(r.user_name || "Unnamed") +
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
  applySource();
  defaultFilters = { ...snapshot(), shown: false, scope: null, label: "" };
  try {
    await loadMe();
    loadNotifications(); loadSpend(); loadSaved(); loadTeam2();
    // Optional paid features show only when their key is set.
    api("/api/features").then((ft) => { $("aiLine").hidden = !ft.aiSearch; $("verifyBtn").hidden = !ft.emailVerify; }).catch(() => {});
    const [countries, categories] = await Promise.all([api("/api/geo/countries"), api("/api/categories")]);
    geo.countries = countries; tree = categories;
    whereCountry.refresh(); what.refresh();
    await restoreLastFind().catch(() => {});
    acWhat.render(); acWhere.render();
    // Searches I started that are still running (e.g. after reloading the page): follow them again.
    const mine = await api("/api/searches?status=pending&status=scraping&status=ingesting&limit=50").catch(() => []);
    const recent = mine.filter((s) => s.created_by === me.id && Date.now() - new Date(s.created_at.replace(" ", "T") + "Z") < 86400000);
    mine.forEach((s) => tracked.add(s.id));
    if (recent.length) {
      startedIds = recent.map((s) => s.id);
      pulls = mine;
      renderProgress();
      useScope(startedIds, recent.length === 1 ? recent[0].category + " in " + placeLabel(recent[0]) : recent.length + " searches still collecting");
    }
    phoneState = await api("/api/phones/status").catch(() => null);
    if (phoneState && phoneState.pending && !/paused|no_service/.test(phoneState.state)) phonesWatched = true;
    if (mine.length || phonesWatched) startPolling();
  } catch (err) { setFindMsg(err.message, true); }
})();
</script>
${THEME_SCRIPT}
</body>
</html>`;
