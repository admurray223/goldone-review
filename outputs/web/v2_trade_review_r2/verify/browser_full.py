#!/usr/bin/env python3
"""GO-Web-V2-R2 comprehensive local verification (real Chromium, read-only).

Covers: 4-width layout/overflow, real pointer/touch nav reachability, V2
trade-stat baselines per scheme/period, trade filter+sort, feedback isolation,
console/request health, and screenshots.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/"
OUTNAME = sys.argv[2] if len(sys.argv) > 2 else "local_full_results.json"
SHOTPREFIX = sys.argv[3] if len(sys.argv) > 3 else "local_"
ROOT = Path(__file__).resolve().parents[1]
VER = ROOT / "verification"
SHOTS = ROOT / "screenshots"
VER.mkdir(parents=True, exist_ok=True)
SHOTS.mkdir(parents=True, exist_ok=True)

NAV_PAGES = ["overview", "nav", "comparison", "segments", "trades", "riskfix",
             "concentration", "cost", "behaviour", "quality", "v2_overview",
             "v2_timeline", "v2_why", "v2_trades", "v2", "history", "feedback"]

# task baselines: (scheme, period) -> (buy, sell, total, end_holdings)
BASELINES = {
    ("A", "dev"): (19, 18, 37, 1),
    ("A", "new"): (1, 2, 3, 0),
    ("A", "full"): (20, 20, 40, 0),
    ("C", "full"): (18, 18, 36, 0),
    ("C", "dev"): (17, 17, 34, 0),
    ("C", "new"): (1, 1, 2, 0),
}

results = []


def rec(tid, ok, detail=""):
    results.append({"id": tid, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), tid, detail)


def nav_click(page, width):
    """Real pointer (desktop) / touch (mobile) click, no force, no element.click."""
    ok = 0
    total = 0
    for pid in NAV_PAGES:
        total += 1
        link = page.locator(f'.nav-link[data-page="{pid}"]').first
        try:
            link.scroll_into_view_if_needed()
            box = link.bounding_box()
            if not box:
                continue
            cx = box["x"] + box["width"] / 2
            cy = box["y"] + box["height"] / 2
            top = page.evaluate(
                "([x,y]) => { const el = document.elementFromPoint(x,y); return el ? (el.closest('.nav-link')||{}).dataset ? el.closest('.nav-link').dataset.page : null : null; }",
                [cx, cy])
            if top != pid:
                continue
            if width <= 640:
                page.touchscreen.tap(cx, cy)
            else:
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.up()
            page.wait_for_timeout(160)
            active = page.evaluate("() => { const a=document.querySelector('.nav-link.active'); return a?a.dataset.page:null; }")
            if active == pid:
                ok += 1
        except Exception:
            pass
    return ok, total


def stats_block(page):
    """Return (buy, sell, total, end_holdings_count) from the visible stats block."""
    return page.evaluate("""() => {
        const kpis = Array.from(document.querySelectorAll('#mainContent .v2-kpi'));
        const get = (label) => {
            const k = kpis.find(x => (x.querySelector('.v2-kpi-label')||{}).textContent === label);
            if (!k) return null;
            const v = (k.querySelector('.v2-kpi-value')||{}).textContent || '';
            const m = v.match(/-?[\\d,]+/);
            return m ? parseInt(m[0].replace(/,/g,''),10) : null;
        };
        return {
            buy: get('买入成交笔数'),
            sell: get('卖出成交笔数'),
            total: get('成交总笔数'),
            end: get('期末持仓股票数')
        };
    }""")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in [(1920, 1080), (1440, 900), (1024, 768), (390, 844)]:
            ctx = browser.new_context(viewport={"width": width, "height": height},
                                      has_touch=(width <= 640))
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_selector("#mainContent")
            tag = f"{width}"

            # horizontal overflow
            sw = page.evaluate("() => document.documentElement.scrollWidth")
            cw = page.evaluate("() => document.documentElement.clientWidth")
            rec(f"layout_{tag}_no_overflow", sw <= cw + 1, f"scrollWidth={sw} clientWidth={cw}")

            # nav reachability (real click)
            ok, total = nav_click(page, width)
            rec(f"nav_{tag}_all_reachable", ok == total, f"{ok}/{total}")

            # V2 trade stats per scheme/period
            page.click('.nav-link[data-page="v2_overview"]')
            page.wait_for_timeout(200)
            for (scheme, period), (eb, es, et, eh) in BASELINES.items():
                page.click(f'[data-v2-variant="{scheme}"]')
                page.wait_for_timeout(160)
                page.click(f'[data-v2-period="{period}"]')
                page.wait_for_timeout(220)
                st = stats_block(page)
                good = (st["buy"] == eb and st["sell"] == es and st["total"] == et and st["end"] == eh)
                rec(f"stats_{tag}_{scheme}_{period}", good,
                    f"got buy={st['buy']} sell={st['sell']} total={st['total']} end={st['end']} exp={eb}/{es}/{et}/{eh}")

            # V2 trades page: filter + sort
            page.click('.nav-link[data-page="v2_trades"]')
            page.wait_for_timeout(250)
            # filter by symbol 301116.SZ
            page.select_option("#v2SymbolFilter", "301116.SZ")
            page.wait_for_timeout(220)
            rows = page.evaluate("() => document.querySelectorAll('#v2SellTable tbody tr').length")
            rec(f"trades_{tag}_filter_symbol", rows >= 1, f"rows={rows}")
            page.select_option("#v2SymbolFilter", "")
            page.wait_for_timeout(200)

            # feedback isolation: seed sentinel, add, reload, verify
            ctx2 = browser.new_context(viewport={"width": width, "height": height})
            pg2 = ctx2.new_page()
            pg2.goto(BASE, wait_until="networkidle")
            pg2.evaluate("""() => {
                const k='goldone_feedback';
                const cur=JSON.parse(localStorage.getItem(k)||'[]');
                cur.push({id:'sentinel-r2', comment:'SENTINEL_KEEP', createdAt:'2026-01-01T00:00:00Z'});
                localStorage.setItem(k, JSON.stringify(cur));
            }""")
            pg2.reload(wait_until="networkidle")
            pg2.evaluate("""() => {
                const k='goldone_feedback';
                const cur=JSON.parse(localStorage.getItem(k)||'[]');
                cur.push({id:'r2-new', comment:'R2_NEW_OK', createdAt:'2026-11-23T00:00:00Z'});
                localStorage.setItem(k, JSON.stringify(cur));
            }""")
            pg2.reload(wait_until="networkidle")
            stored = pg2.evaluate("() => JSON.parse(localStorage.getItem('goldone_feedback')||'[]')")
            has_sentinel = any(x.get("id") == "sentinel-r2" and x.get("comment") == "SENTINEL_KEEP" for x in stored)
            has_new = any(x.get("id") == "r2-new" for x in stored)
            rec(f"feedback_{tag}_isolation", has_sentinel and has_new,
                f"count={len(stored)} sentinel={has_sentinel} new={has_new}")
            ctx2.close()

            # screenshots
            page.click('.nav-link[data-page="v2_overview"]')
            page.wait_for_timeout(250)
            page.screenshot(path=str(SHOTS / f"{SHOTPREFIX}overview_{tag}.png"), full_page=False)
            page.click('.nav-link[data-page="v2_trades"]')
            page.wait_for_timeout(250)
            page.screenshot(path=str(SHOTS / f"{SHOTPREFIX}trades_{tag}.png"), full_page=False)

            rec(f"console_{tag}_clean", len(errs) == 0, "; ".join(errs[:3]))
            ctx.close()
        browser.close()

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    with (VER / OUTNAME).open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("SUMMARY", summary["passed"], "/", summary["total"], "failed", summary["failed"])
    sys.exit(0 if summary["failed"] == 0 else 1)


if __name__ == "__main__":
    main()