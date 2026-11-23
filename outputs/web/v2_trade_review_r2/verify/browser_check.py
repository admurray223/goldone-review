#!/usr/bin/env python3
"""GO-Web-V2-R2 local browser verification (read-only, real Chromium)."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

import sys as _sys
BASE = _sys.argv[1] if len(_sys.argv) > 1 else "http://127.0.0.1:8137/"
OUT = Path(__file__).resolve().parents[1] / "verification"
OUT.mkdir(parents=True, exist_ok=True)
SHOTS = Path(__file__).resolve().parents[1] / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

results = []


def rec(tid, ok, detail=""):
    results.append({"id": tid, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), tid, detail)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_selector("#mainContent")

        # navigate to V2 overview
        page.click('[data-page="v2_overview"]')
        page.wait_for_timeout(400)
        body = page.inner_text("#mainContent")
        rec("overview_stats_buy", "买入成交笔数" in body)
        rec("overview_stats_total", "成交总笔数" in body)
        rec("overview_end_holdings", "期末持仓股票数" in body)
        rec("overview_end_date", "区间结束日期" in body)
        rec("overview_scoring_audit", "评分方向专项审计" in body)
        rec("overview_scoring_conflict", "方向冲突" in body)

        # check default period full A end holdings = 0
        rec("overview_full_end0", "期末持仓股票数" in body and "0 只" in body)

        # switch to dev period
        page.click('[data-v2-period="dev"]')
        page.wait_for_timeout(400)
        body = page.inner_text("#mainContent")
        rec("dev_end_holdings_1", "期末持仓股票数" in body and "1 只" in body)
        # expand holdings detail
        page.click('summary:has-text("展开期末持仓明细")')
        page.wait_for_timeout(200)
        body = page.inner_text("#mainContent")
        rec("dev_holdings_detail_605138", "605138.SH" in body)

        # V2 trades page
        page.click('[data-page="v2_trades"]')
        page.wait_for_timeout(400)
        body = page.inner_text("#mainContent")
        rec("trades_stats_total", "成交总笔数" in body)
        rec("trades_cycle_table", "成交与持仓周期" in body)
        rec("trades_notes_cards", "新阶段三笔成交解释" in body)
        html = page.content()
        rec("trades_notes_shenghui", "盛泰集团" in html)
        rec("trades_notes_tonghao", "中国通号" in html)
        rec("trades_notes_not_reconstruct", "无法重建" in html)
        rec("trades_scoring_audit", "评分方向专项审计" in body)
        # dev period should show open 605138 "尚未卖出"
        page.click('[data-v2-period="dev"]')
        page.wait_for_timeout(400)
        body = page.inner_text("#mainContent")
        rec("dev_open_not_sold", "尚未卖出" in body)

        # color check: red-up / green-down
        # compute a positive and negative sample via JS
        pos_color = page.evaluate("""() => {
            const el = document.createElement('span');
            el.className = 'positive'; el.textContent = '+1%';
            document.body.appendChild(el);
            const c = getComputedStyle(el).color; el.remove(); return c;
        }""")
        neg_color = page.evaluate("""() => {
            const el = document.createElement('span');
            el.className = 'negative'; el.textContent = '-1%';
            document.body.appendChild(el);
            const c = getComputedStyle(el).color; el.remove(); return c;
        }""")
        # rgb red ~ (217,54,62) ; green ~ (26,158,95)
        def is_red(c):
            nums = [int(x) for x in c.replace("rgba", "").replace("rgb", "").strip("() ").split(",")[:3]]
            return nums[0] > 150 and nums[1] < 110 and nums[2] < 110
        def is_green(c):
            nums = [int(x) for x in c.replace("rgba", "").replace("rgb", "").strip("() ").split(",")[:3]]
            return nums[1] > 110 and nums[0] < 120
        rec("color_positive_red", is_red(pos_color), pos_color)
        rec("color_negative_green", is_green(neg_color), neg_color)

        # screenshots at 4 widths
        for w, h in [(1920, 1080), (1440, 900), (1024, 768), (390, 844)]:
            page.set_viewport_size({"width": w, "height": h})
            page.click('[data-page="v2_overview"]')
            page.wait_for_timeout(300)
            page.screenshot(path=str(SHOTS / f"overview_{w}.png"))
            page.click('[data-page="v2_trades"]')
            page.wait_for_timeout(300)
            page.screenshot(path=str(SHOTS / f"trades_{w}.png"))

        rec("console_errors", len(errors) == 0, "; ".join(errors[:3]))

        ctx.close()
        browser.close()

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    with (OUT / "local_browser_results.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("SUMMARY", summary["passed"], "/", summary["total"])
    sys.exit(0 if summary["failed"] == 0 else 1)


if __name__ == "__main__":
    main()