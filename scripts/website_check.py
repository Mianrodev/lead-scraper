"""
Lead Finder website check: visits each business's website once and reports what it finds.

Runs on GitHub Actions next to the free collector (see .github/workflows/free-collect.yml):
it asks Lead Finder for a batch of websites, visits them (a few dozen at a time, one page per
site plus a contact page when no email was found), and sends the findings back. Standard
library only. Lead Finder paces how many it hands out a day.

Run it yourself (e.g. to test):
    set LEAD_FINDER_URL=https://lead-scraper.dev1-024.workers.dev
    set LEAD_FINDER_COLLECTOR_SECRET=<the collector secret>
    python scripts/website_check.py
    python scripts/website_check.py --try https://example.com   (just print what it finds)
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import html as htmllib
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overture_collect import Api  # noqa: E402  (same sign-in as the free collector)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
MAX_BYTES = 200_000
TIMEOUT = 12
WORKERS = 24
SEND_EVERY = 100
TIME_BUDGET = 8 * 60  # stop asking for more after 8 minutes (the next run starts 10 minutes later)

SOCIAL_HOSTS = ("facebook.com", "fb.com", "instagram.com", "linktr.ee", "yelp.com", "business.site", "google.com",
                "g.page", "nextdoor.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com",
                "homeadvisor.com", "angi.com", "thumbtack.com", "bbb.org", "yellowpages.com", "houzz.com", "porch.com")
BUILDERS = [
    ("highlevel", ("leadconnectorhq", "msgsndr", "highlevel")),
    ("wix", ("wixstatic.com", "x-wix", "wix.com website builder", "_wixcss")),
    ("squarespace", ("squarespace",)),
    ("shopify", ("cdn.shopify.com", "shopify.theme")),
    ("webflow", ("data-wf-page", "data-wf-site", "webflow.io", "webflow.com")),
    ("duda", ("multiscreensite.com", "dudamobile", "duda_website", "dudaone")),
    ("godaddy", ("img1.wsimg.com", "wsimg.com", "godaddy website builder", "gdwebsites")),
    ("weebly", ("weebly.com", "editmysite.com")),
    ("wordpress", ("wp-content", "wp-json", "wp-includes", 'content="wordpress')),
]
BOOKING = [
    ("calendly", "calendly.com"), ("acuity", "acuityscheduling.com"), ("square", "squareup.com/appointments"),
    ("square", "square.site/book"), ("booksy", "booksy.com"), ("vagaro", "vagaro.com"), ("setmore", "setmore.com"),
    ("housecall pro", "housecallpro.com"), ("servicetitan", "servicetitan.com"), ("jobber", "getjobber.com"),
    ("mindbody", "mindbodyonline.com"), ("schedulicity", "schedulicity.com"), ("simplybook", "simplybook."),
    ("zocdoc", "zocdoc.com"), ("highlevel", "leadconnectorhq.com/widget/booking"), ("highlevel", "/widget/bookings/"),
    ("workiz", "workiz.com"), ("service fusion", "servicefusion.com"), ("fieldedge", "fieldedge.com"),
    ("schedule engine", "scheduleengine"), ("gettimely", "gettimely.com"), ("fresha", "fresha.com"),
]
BOOKING_WORDS = ("book online", "book now", "schedule online", "schedule service", "schedule now", "book an appointment",
                 "schedule an appointment", "book appointment", "request an appointment", "online booking")
CHAT = ("tawk.to", "intercom", "js.driftt.com", "drift.com", "tidio", "crisp.chat", "livechatinc", "livechat.com",
        "podium", "birdeye", "widgets.leadconnectorhq.com", "leadconnectorhq.com/loader", "chat-widget", "olark",
        "zendesk", "zopim", "freshchat", "hubspot-messages", "usemessages.com", "smartsupp", "chatra", "webchat")
FORM_TOOLS = ("leadconnectorhq.com/widget/form", "/widget/form/", "jotform", "typeform", "wpforms", "gform_", "gravityforms",
              "wpcf7", "contact-form-7", "hsforms", "formstack", "ninja-forms", "formidable", "cognitoforms", "wufoo")
SOCIAL_PATTERNS = {
    "facebook": r"facebook\.com/(?!sharer|share|plugins|dialog|tr\?|tr/|login|policies|help|privacy)[A-Za-z0-9_.\-/%?=]+",
    "instagram": r"instagram\.com/(?!p/|explore|accounts)[A-Za-z0-9_.]+",
    "linkedin": r"linkedin\.com/(?:company|in)/[A-Za-z0-9_\-%]+",
    "x": r"(?:twitter|x)\.com/(?!intent|share|home|search)[A-Za-z0-9_]{2,}",
    "youtube": r"youtube\.com/(?:channel/|c/|user/|@)[A-Za-z0-9_\-]+",
    "tiktok": r"tiktok\.com/@[A-Za-z0-9_.]+",
    "yelp": r"yelp\.com/biz/[A-Za-z0-9_\-%]+",
    "nextdoor": r"nextdoor\.com/(?:pages|page)/[A-Za-z0-9_\-%/]+",
    "pinterest": r"pinterest\.com/(?!pin/)[A-Za-z0-9_]+",
}
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
EMAIL_JUNK = ("example.com", "domain.com", "sentry", "wixpress", "email.com", "yourdomain", "yoursite", "test.com",
              "godaddy.com", "squarespace.com", "wix.com", "schema.org", "sentry.io", "@2x", "@3x", "placeholder",
              "yourname", "youremail", "johndoe", "john.doe", "jane.doe")
JUNK_LOCAL = {"name", "user", "username", "email", "your", "you", "someone", "first.last", "firstname.lastname"}
IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js")
YEAR_RE = re.compile(r"(?:©|&copy;|&#169;|copyright)\s*(?:[a-z.,]*\s*)?(?:(?:19|20)\d{2}\s*[-–—]\s*)?((?:19|20)\d{2})", re.I)
BLOCKED_STATUS = (401, 403, 429, 503)


def host_of(url: str) -> str:
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def is_social(url: str) -> bool:
    h = host_of(url)
    return any(h == s or h.endswith("." + s) for s in SOCIAL_HOSTS)


def cf_decode(hexstr: str) -> str:
    """Cloudflare hides emails as data-cfemail="<hex>"; the first byte is the key."""
    try:
        key = int(hexstr[:2], 16)
        return "".join(chr(int(hexstr[i:i + 2], 16) ^ key) for i in range(2, len(hexstr), 2))
    except ValueError:
        return ""


def find_emails(html: str, site_host: str) -> list[str]:
    # Visible text and links only: scripts, styles and comments carry theme / font authors' emails.
    visible = re.sub(r"<(script|style)\b[\s\S]*?</\1>|<!--[\s\S]*?-->", " ", html, flags=re.I)
    raw = EMAIL_RE.findall(visible)
    raw += [cf_decode(h) for h in re.findall(r'data-cfemail="([0-9a-fA-F]+)"', html)]
    raw += [urllib.parse.unquote(m) for m in re.findall(r"mailto:([^\"'?>\s]+)", html, re.I)]
    out: list[str] = []
    for e in raw:
        e = htmllib.unescape(e).strip().strip(".").lower()
        if not EMAIL_RE.fullmatch(e) or len(e) > 120:
            continue
        if any(j in e for j in EMAIL_JUNK) or e.endswith(IMG_EXT) or e.split("@")[0] in JUNK_LOCAL:
            continue
        if e not in out:
            out.append(e)
    base = site_host.split(".")[-2] if site_host.count(".") >= 1 else site_host
    out.sort(key=lambda e: 0 if base and base in e.split("@")[1] else 1)
    return out[:5]


def find_socials(html: str) -> list[str]:
    found: list[str] = []
    for name, pat in SOCIAL_PATTERNS.items():
        m = re.search(r"https?://(?:www\.|m\.|[a-z]{2}-[a-z]{2}\.)?" + pat, html, re.I)
        if m:
            url = m.group(0).rstrip("/\\\"'").split("\\")[0]
            url = re.sub(r"^http://", "https://", url, flags=re.I)
            found.append(url[:300])
    return found


def has_contact_form(html: str, low: str) -> bool:
    if any(t in low for t in FORM_TOOLS):
        return True
    for form in re.findall(r"<form\b[\s\S]{0,8000}?</form>", low):
        if re.search(r'type=["\']?(email|tel)', form) or re.search(r'name=["\'][^"\']*(email|phone|message)', form):
            return True
    return False


def analyze(html: str, url: str) -> dict:
    html = html[:MAX_BYTES]
    low = html.lower()
    builder = next((name for name, sigs in BUILDERS if any(s in low for s in sigs)), "other")
    booking_tool = next((name for name, sig in BOOKING if sig in low), None)
    title = re.search(r"<title[^>]*>([\s\S]{0,300}?)</title>", html, re.I)
    years = [int(y) for y in YEAR_RE.findall(html)]
    this_year = time.gmtime().tm_year
    years = [y for y in years if 1995 <= y <= this_year + 1]
    return {
        "title": htmllib.unescape(re.sub(r"\s+", " ", title.group(1))).strip()[:200] if title else None,
        "builder": builder,
        "hasMetaPixel": "fbq(" in low or "fbevents.js" in low,
        "hasGoogleTag": any(s in low for s in ("googletagmanager.com/gtag/js", "gtag(", "googletagmanager.com/gtm.js", "google-analytics.com")),
        "hasTiktokPixel": "analytics.tiktok.com" in low or "ttq.load" in low,
        "hasBooking": bool(booking_tool) or any(w in low for w in BOOKING_WORDS),
        "bookingTool": booking_tool,
        "hasContactForm": has_contact_form(html, low),
        "hasChatWidget": any(s in low for s in CHAT),
        "mobileViewport": bool(re.search(r"<meta[^>]+name=[\"']?viewport", low)),
        "emails": find_emails(html, host_of(url)),
        "socials": find_socials(html),
        "copyrightYear": max(years) if years else None,
        "_links": re.findall(r"href=[\"']([^\"'#]*(?:contact|about)[^\"'#]*)[\"']", html, re.I)[:5],
    }


def fetch(url: str) -> tuple[int | None, str, str, bool, str | None]:
    """(status, final url, html, served over https, error). Tries the other spellings a browser
    would get to: http when https fails, and www. when the bare name doesn't exist."""
    if not re.match(r"^https?://", url, re.I):
        url = "http://" + url
    first = fetch_once(url)
    if first[0] is not None:
        return first
    parts = urllib.parse.urlsplit(url)
    tries = []
    if parts.scheme.lower() == "https":
        tries.append(parts._replace(scheme="http").geturl())
    if first[4] == "the web address doesn't exist" and parts.hostname and not parts.hostname.lower().startswith("www."):
        tries.append(parts._replace(netloc="www." + parts.netloc).geturl())
    for alt in tries:
        got = fetch_once(alt)
        if got[0] is not None:
            return got
    return first


def fetch_once(url: str) -> tuple[int | None, str, str, bool, str | None]:
    headers = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"}
    for verify in (True, False):
        ctx = ssl.create_default_context()
        if not verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as res:
                final = res.geturl()
                ctype = res.headers.get("Content-Type", "")
                body = res.read(MAX_BYTES)
                charset = res.headers.get_content_charset() or "utf-8"
                text = body.decode(charset, "replace") if "html" in ctype.lower() or not ctype else ""
                secure = final.lower().startswith("https://") and verify
                return res.status, final, text, secure, None if verify else "security certificate problem"
        except urllib.error.HTTPError as e:
            body = e.read(MAX_BYTES).decode("utf-8", "replace") if e.fp else ""
            return e.code, e.geturl() or url, body, (e.geturl() or url).lower().startswith("https://") and verify, f"HTTP {e.code}"
        except (ssl.SSLError, ssl.CertificateError) as e:
            if verify:
                continue
            return None, url, "", False, f"security problem: {e.__class__.__name__}"
        except urllib.error.URLError as e:
            reason = e.reason
            if verify and isinstance(reason, (ssl.SSLError, ssl.CertificateError)):
                continue
            return None, url, "", False, short_error(reason)
        except Exception as e:  # noqa: BLE001  (timeouts, resets, bad responses)
            return None, url, "", False, short_error(e)
    return None, url, "", False, "couldn't connect"


def short_error(e: object) -> str:
    s = str(e)
    if "timed out" in s.lower():
        return "took too long to answer"
    if "Name or service not known" in s or "getaddrinfo" in s or "nodename" in s:
        return "the web address doesn't exist"
    if "refused" in s.lower():
        return "connection refused"
    return s[:120] or e.__class__.__name__


def check_site(item: dict) -> dict:
    lead_id, url = item["id"], item["url"]
    status, final, html, secure, error = fetch(url)
    out = {"id": lead_id, "finalUrl": final[:500], "httpStatus": status, "https": secure, "pagesChecked": 1, "error": error,
           "reachable": False, "socialOnly": is_social(final), "emails": [], "socials": []}
    if status is None:
        return out
    blocked = status in BLOCKED_STATUS and ("cloudflare" in html.lower() or "captcha" in html.lower() or status in (401, 403, 429))
    if 300 <= status < 400:
        # A redirect we couldn't follow: the site exists, but we can't see the page.
        out.update(reachable=True, error="blocked: the site sends visitors somewhere we couldn't follow")
        return out
    if status >= 400 and not blocked:
        out["error"] = f"the site answers with an error (HTTP {status})"
        return out
    out["reachable"] = True
    if blocked:
        out["error"] = "blocked: the site blocks automated visits"
        return out
    if out["socialOnly"] or not html:
        return out
    found = analyze(html, final)
    links = found.pop("_links")
    if not found["emails"] and links:
        nxt = urllib.parse.urljoin(final, links[0])
        if host_of(nxt) == host_of(final):
            s2, f2, h2, _, _ = fetch(nxt)
            if s2 and s2 < 400 and h2:
                more = analyze(h2, f2)
                found["emails"] = more["emails"]
                found["hasContactForm"] = found["hasContactForm"] or more["hasContactForm"]
                found["hasBooking"] = found["hasBooking"] or more["hasBooking"]
                found["bookingTool"] = found["bookingTool"] or more["bookingTool"]
                found["socials"] = found["socials"] or more["socials"]
                out["pagesChecked"] = 2
    out.update(found)
    return out


def run(api: Api):
    api.base = api.root + "/websites"
    started = time.time()
    total = 0
    while time.time() - started < TIME_BUDGET:
        batch = api.post_json("/claim", {}).get("items") or []
        if not batch:
            break
        print(f"Checking {len(batch)} websites...", flush=True)
        results: list[dict] = []
        with cf.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(check_site, it): it for it in batch}
            for fut in cf.as_completed(futures):
                it = futures[fut]
                try:
                    results.append(fut.result())
                except Exception as e:  # noqa: BLE001
                    results.append({"id": it["id"], "reachable": False, "error": short_error(e)})
                if len(results) >= SEND_EVERY:
                    api.post_json("/results", {"results": results})
                    total += len(results)
                    results = []
        if results:
            api.post_json("/results", {"results": results})
            total += len(results)
        print(f"  sent {total} so far", flush=True)
    print(f"Done: checked {total} websites.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--try", dest="try_url", help="check one website and print the findings")
    a = p.parse_args()
    if a.try_url:
        print(json.dumps(check_site({"id": "test", "url": a.try_url}), indent=1))
        return
    base = os.environ.get("LEAD_FINDER_URL", "https://lead-scraper.dev1-024.workers.dev")
    run(Api(base, os.environ.get("LEAD_FINDER_COLLECTOR_SECRET") or None))


if __name__ == "__main__":
    main()
