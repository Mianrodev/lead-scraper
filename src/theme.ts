// One look for both apps (internal Lead Finder and the customer store/website): the Goes Local
// family (warm cream, deep navy, orange highlight, Fraunces headings + Inter text) in a light and
// a dark version. In light mode the highlight is the brand colour darkened by 20%, so white
// button text and orange links stay readable (the raw brand orange is only ~3.7:1 on white). People get their device's setting by default and can flip it with the sun/moon
// button; the choice is remembered per browser (localStorage "theme").
//
// Everything here is pasted into HTML template literals, so it must not contain backticks,
// backslashes or dollar-brace sequences (the page scripts follow the same rule).

export const DEFAULT_ACCENT = "#E4572E";

export const FONT_LINKS =
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap">`;

const LIGHT = `
    color-scheme: light;
    --bg: #FBF5EA; --panel: #ffffff; --panel-2: #FDF9F2; --chip: #F1E7D6; --text: #1B2A3A; --head: #12263F; --muted: #4A5D72; --line: #E8DCC8; --line-strong: #D9C9AE;
    --accent: color-mix(in srgb, var(--brand) 80%, #000000); --on-accent: #ffffff;
    --ok: #1F7A4D; --ok-soft: #E6F4EC; --warn: #9A5B00; --warn-soft: #FFF1D6; --bad: #B42318; --bad-soft: #FDECEA;
    --shadow: 0 1px 2px rgba(18, 38, 63, .04), 0 8px 24px rgba(18, 38, 63, .06);
    --shadow-pop: 0 12px 32px rgba(18, 38, 63, .16);
    --backdrop: rgba(18, 28, 44, .45);
    --invert-bg: #12263F; --invert-text: #ffffff;
    --map-filter: none;`;

const DARK = `
    color-scheme: dark;
    --bg: #0E1622; --panel: #152132; --panel-2: #111C2B; --chip: #1F2D41; --text: #E6ECF3; --head: #F6F0E4; --muted: #9DAEC2; --line: #243348; --line-strong: #34475F;
    --accent: color-mix(in srgb, var(--brand) 82%, #ffffff); --on-accent: #10161F;
    --ok: #5BC98D; --ok-soft: #12301F; --warn: #F2B456; --warn-soft: #33270E; --bad: #F7837A; --bad-soft: #3A1A18;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 6px 18px rgba(0, 0, 0, .28);
    --shadow-pop: 0 14px 36px rgba(0, 0, 0, .5);
    --backdrop: rgba(3, 7, 14, .65);
    --invert-bg: #F6F0E4; --invert-text: #12263F;
    --map-filter: invert(1) hue-rotate(180deg) brightness(.92) contrast(.9);`;

/**
 * The colour tokens. `accent` is the brand highlight (a checked #hex). Light by default, dark when
 * the device prefers it (unless the person picked light), or when they picked dark.
 */
export function themeCss(accent: string = DEFAULT_ACCENT): string {
  return `
  :root { --brand: ${accent};${LIGHT}
    --radius: 14px;
    --serif: Fraunces, Georgia, "Times New Roman", serif;
    --sans: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK} } }
  :root[data-theme="dark"] {${DARK} }
  :root { --accent-soft: color-mix(in srgb, var(--accent) 13%, var(--panel)); --accent-line: color-mix(in srgb, var(--accent) 42%, var(--panel));
    --accent-strong: color-mix(in srgb, var(--accent) 72%, var(--text)); }
  body { background: var(--bg); color: var(--text); }
  .leaflet-tile-pane { filter: var(--map-filter); }
  .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--panel); color: var(--text); box-shadow: var(--shadow-pop); }
  .leaflet-bar a, .leaflet-bar a:hover { background: var(--panel); color: var(--text); border-color: var(--line); }
  .leaflet-container .leaflet-control-attribution { background: color-mix(in srgb, var(--panel) 80%, transparent); color: var(--muted); }
  .leaflet-container .leaflet-control-attribution a { color: var(--accent); }
  /* A clear keyboard focus ring everywhere (pages may add their own on top). */
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .theme-btn { width: 34px; height: 34px; padding: 0; display: inline-grid; place-items: center; border-radius: 999px; font-size: 16px; line-height: 1;
    background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); box-shadow: none; cursor: pointer; flex: none; }
  .theme-btn:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
`;
}

/** Runs in <head> before the page paints, so a saved choice never flashes the wrong colours. */
export const THEME_BOOT = `<script>try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>`;

/** The sun/moon button. Put it anywhere; THEME_SCRIPT wires every one on the page. */
export const THEME_BUTTON = `<button type="button" class="theme-btn" data-theme-toggle aria-label="Switch to dark mode" title="Switch to dark mode">&#9790;</button>`;

/** Flips light/dark, remembers it, and tells the page (event "themechange") so maps/charts can redraw. */
export const THEME_SCRIPT = `<script>(function(){
  function now(){var d=document.documentElement.getAttribute("data-theme");if(d==="light"||d==="dark")return d;return window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
  function paint(){var dark=now()==="dark";var label=dark?"Switch to light mode":"Switch to dark mode";
    document.querySelectorAll("[data-theme-toggle]").forEach(function(b){b.innerHTML=dark?"&#9728;":"&#9790;";b.title=label;b.setAttribute("aria-label",label);});
    var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()||"#FBF5EA");}
  document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("[data-theme-toggle]"):null;if(!b)return;
    var next=now()==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",next);try{localStorage.setItem("theme",next);}catch(x){}
    paint();document.dispatchEvent(new CustomEvent("themechange",{detail:next}));});
  if(window.matchMedia)try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",paint);}catch(x){}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",paint);else paint();
})();</script>`;
