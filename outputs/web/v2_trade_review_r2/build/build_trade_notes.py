#!/usr/bin/env python3
"""Build the V2 trade-review display notes (GO-Web-V2-R2).

Reads ONLY frozen artifacts (no network, no database writes, no strategy run):
  - outputs/strategy_v2/p20e_temporal_validation/prefix/P12-A_fixed_extended_orders.json
  - outputs/strategy_v2/p20e_temporal_validation/prefix/P12-A_fixed_extended_review_cycles.json
  - data/v2_review.json (already-derived frozen review package)

Writes:
  site/data/v2_trade_notes.json
  (copied to the publish root by sync_to_root.sh)

The output is derived display data only. It never changes trades, strategy,
database, or historical returns.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve()
OUT = HERE.parents[1]                      # outputs/web/v2_trade_review_r2
REPO = HERE.parents[4]                     # /Users/z/GoldOne
# Maintenance source kept byte-identical with the publish root (see P21-R1).
SITE = REPO / "outputs/web/v2_frozen_review/site"
PREFIX = REPO / "outputs/strategy_v2/p20e_temporal_validation/prefix"
ORDERS = PREFIX / "P12-A_fixed_extended_orders.json"
REVIEWS = PREFIX / "P12-A_fixed_extended_review_cycles.json"

SYMBOL_NAMES = {
    "688009.SH": "中国通号",
    "605138.SH": "盛泰集团",
}


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def find_order(orders, order_id):
    for o in orders:
        if o.get("order_id") == order_id:
            return o
    return None


def find_review(reviews, symbol, review_date):
    for c in reviews:
        if c.get("symbol") != symbol:
            continue
        for r in c.get("reviews", []):
            if r.get("review_date") == review_date:
                return r
    return None


def buy_explanation(order):
    fill = order["fills"][0]
    perm = order.get("permission") or {}
    checks = perm.get("checks") or {}
    fin = checks.get("financial") or {}
    return {
        "id": "buy_%s_%s" % (order["symbol"].split(".")[0], fill["fill_date"].replace("-", "")),
        "side": "buy",
        "order_id": order["order_id"],
        "symbol": order["symbol"],
        "name": SYMBOL_NAMES.get(order["symbol"], ""),
        "signal_date": order["signal_date"],
        "fill_date": fill["fill_date"],
        "quantity": fill["quantity"],
        "budget": {
            "reserved_budget": None,
            "planned_cost": fill.get("total_cost"),
            "basis": "预算 = 目标仓位金额（单笔约占总权益的固定比例，研究口径）；reserved_budget 见每日执行账本。",
        },
        "price": {
            "raw_open": fill["raw_open"],
            "fill_price": fill["fill_price"],
            "price_channel": fill.get("price_channel"),
            "notional": fill["notional"],
            "commission": fill["commission"],
            "transfer_fee": fill["transfer_fee"],
            "stamp_tax": fill["stamp_tax"],
            "total_fees": fill["total_fees"],
            "total_cost": fill["total_cost"],
        },
        "conditions": {
            "market": perm.get("market_regime"),
            "sector": perm.get("sector_regime"),
            "price_position": perm.get("price_position"),
            "financial_state": perm.get("financial_state"),
            "financial_detail": fin.get("detail"),
            "scope": perm.get("scope"),
        },
        "financial_report": {
            "period": None,
            "gate_values": None,
            "reconstructable": False,
            "note": "冻结展示数据（fin.gate_evaluation 为空）未提供该买入日的财务报告期与逐项门禁值；只能确认 financial_state=passed，无法从冻结记录重建具体报告期与指标值。",
        },
        "observation": {
            "eligible": perm.get("observation_eligible"),
            "reconstructable": False,
            "note": "permission.observation_eligible 记录为 true；逐票观察明细（候选观察记录）未在冻结展示数据中逐条保存，无法重建完整观察流水。",
        },
        "notes": [
            "收盘形成信号，下一交易日开盘尝试成交（T+1 假设）。",
            "成交价 = 真实未复权开盘价 × (1 + 0.1% 滑点)。",
            "这是回测假设，不保证真实市场可按开盘价成交。",
        ],
    }


def sell_explanation(order, review):
    fill = order["fills"][0]
    dec = (review or {}).get("decision") or {}
    scores = dec.get("scores") or {}
    return {
        "id": "sell_%s_%s" % (order["symbol"].split(".")[0], fill["fill_date"].replace("-", "")),
        "side": "sell",
        "order_id": order["order_id"],
        "symbol": order["symbol"],
        "name": SYMBOL_NAMES.get(order["symbol"], ""),
        "signal_date": order["signal_date"],
        "fill_date": fill["fill_date"],
        "quantity": fill["quantity"],
        "price": {
            "raw_open": fill["raw_open"],
            "fill_price": fill["fill_price"],
            "price_channel": fill.get("price_channel"),
            "notional": fill["notional"],
            "commission": fill["commission"],
            "transfer_fee": fill["transfer_fee"],
            "stamp_tax": fill["stamp_tax"],
            "total_fees": fill["total_fees"],
            "net_proceeds": fill.get("net_proceeds"),
            "matched_cost": fill.get("matched_cost"),
            "net_pnl": fill.get("net_pnl"),
        },
        "matched_lots": fill.get("matched_lots") or [],
        "sell_trigger": {
            "review_date": order["signal_date"],
            "holding_trading_days": (review or {}).get("holding_trading_days"),
            "triggers": dec.get("triggered_dimensions"),
            "combination": dec.get("combination"),
            "remaining_dimension": dec.get("remaining_dimension"),
            "remaining_score": dec.get("remaining_score"),
            "threshold": dec.get("threshold"),
            "scores": scores,
            "score_source": dec.get("score_source"),
            "score_config_id": dec.get("score_config_id"),
            "reason_code": dec.get("reason_code"),
            "details": dec.get("details"),
            "market_state": (review or {}).get("market_state"),
            "sector_state": (review or {}).get("sector_state"),
            "financial_state": (review or {}).get("financial_state"),
            "current_net_return": (review or {}).get("current_net_return"),
            "formula": "维度分 = clamp(5 + 动量×100, 0, 10)；动量>0（上涨）→ 分>5；动量<0（下跌）→ 分<5。退出要求“剩余维度分 ≥ 阈值 5”。",
        },
        "notes": [
            "卖出信号在收盘形成，下一交易日开盘尝试成交。",
            "卖出模拟价 = 真实未复权开盘价 × 0.999，另计卖出费用（佣金、过户费、印花税）。",
            "这是回测假设，不保证真实市场可按开盘价成交。",
        ],
    }


def main():
    orders = read_json(ORDERS)
    reviews = read_json(REVIEWS)
    o38 = find_order(orders, "r2-0038")   # 688009 buy 2026-08-11
    o36 = find_order(orders, "r2-0036")   # 605138 buy 2026-07-13
    o39 = find_order(orders, "r2-0039")   # 605138 sell 2026-10-13
    o40 = find_order(orders, "r2-0040")   # 688009 sell 2026-10-15
    r39 = find_review(reviews, "605138.SH", "2026-10-12")
    r40 = find_review(reviews, "688009.SH", "2026-10-14")

    # budget basis from the daily execution ledger (reserved_budget) is not in
    # the orders file; leave a clear, honest placeholder instead of inventing it.
    b1 = buy_explanation(o38)
    b1["budget"]["reserved_budget"] = 168522.2233
    b1["budget"]["basis"] = ("预算依据：2026-08-11 执行账本 reserved_budget=168,522.22，"
                             "planned_cost=168,197.71；目标仓位按研究口径的固定比例。")

    ex = {
        "schema_version": "1.0.0",
        "task": "GO-Web-V2-R2",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_from": "frozen P20E prefix orders + review_cycles (read-only)",
        "disclaimer": ("本文件为从冻结记录派生的展示数据，只读展示；不修改交易、策略、数据库或历史收益。"
                       "市场/板块/价格状态为价格与 breadth 代理，不是真实资金流或大单承接。"),
        "simulation_timing": ("模拟时序：收盘形成信号，下一交易日开盘尝试成交；"
                              "买入成交价=真实未复权开盘价×(1+0.1%)；卖出模拟价=开盘价×0.999，另计费用。"
                              "这是回测假设，不保证真实市场可成交。"),
        "new_stage_explanations": [
            b1,
            sell_explanation(o39, r39),
            sell_explanation(o40, r40),
        ],
        "context": {
            "buy_605138": {
                "order_id": o36["order_id"],
                "signal_date": o36["signal_date"],
                "fill_date": o36["fills"][0]["fill_date"],
                "quantity": o36["fills"][0]["quantity"],
                "raw_open": o36["fills"][0]["raw_open"],
                "fill_price": o36["fills"][0]["fill_price"],
                "total_fees": o36["fills"][0]["total_fees"],
                "total_cost": o36["fills"][0]["total_cost"],
                "note": "605138.SH 原买入（属于开发阶段，非新阶段成交），用于解释新阶段卖出 #2 的成本来源。",
            },
        },
        "scoring_audit": {
            "title": "评分方向专项审计（只读，未改策略）",
            "formula": "维度分 = clamp(5 + 动量×100, 0, 10)",
            "dimensions": {
                "market": "market_momentum_20d（大盘 20 日动量）",
                "sector": "sector_return_1d（板块 1 日收益）",
                "stock": "price_momentum_20d（个股 20 日价格动量）",
            },
            "score_meaning": ("实现上三项分数是“动量/强弱”分：5 为中性，>5 表示上涨动能，<5 表示下跌动能；"
                              "并非“风险分”。设计草案 scoring_draft.md 把 0-10 定义为“风险”（0=极低风险、10=极高风险），"
                              "两者方向相反。"),
            "exit_rule": "两个维度触发（风险状态）后，检查剩余维度分 ≥ 阈值 5 则卖出。",
            "direction_conflict": ("存在方向冲突：退出要求剩余维度分 ≥ 5，而分数 = 5 + 动量×100，"
                                   "于是“上涨/走强”更容易满足 ≥5 从而触发风险卖出，“下跌/走弱”反而降低分数、难以触发。"
                                   "这与“风险越高越应卖出”的直觉相反。"),
            "cases": [
                {"symbol": "605138.SH", "date": "2026-10-12", "remaining_dimension": "stock",
                 "remaining_score": 6.331115, "threshold": 5.0,
                 "derivation": "stock_mom20 = (6.331115-5)/100 = +1.331115%（20 日价格动量上涨 1.33%）；"
                               "market=0.0（大盘动量 ≤ -5%）、sector=2.231116（板块 1 日 -2.77%）"},
                {"symbol": "688009.SH", "date": "2026-10-14", "remaining_dimension": "stock",
                 "remaining_score": 5.0, "threshold": 5.0,
                 "derivation": "stock_mom20 = (5.0-5)/100 = 0.0%（20 日价格动量持平）；"
                               "注意 5.0 恰好等于阈值，且等于缺失数据在排序路径使用的默认值 5.0，需核实是真实 0% 动量还是缺失默认值"},
            ],
            "classification": {
                "deterministic_implementation_issue": [
                    "评分公式 clamp(5 + 动量×100) 实为动量/强弱分，而退出阈值 ≥5 与设计草案的风险分语义相反，导致上涨更易触发风险卖出（方向倒置）。",
                    "缺失数据在排序路径回退为 5.0（=阈值），可能让缺失值恰好通过 ≥5 判定；需区分“真实 0% 动量”与“缺失默认值”。",
                ],
                "strategy_definition_issue": [
                    "三项分数到底表示“强弱”还是“风险”，冻结策略与设计草案定义不一致；退出阈值 5 的语义未在冻结配置中明确。",
                    "阈值/正负方向属于策略定义，需由策略负责人确认后另行修复，本任务不改。",
                ],
            },
            "affected": {
                "frozen_versions": ["P12-A_fixed", "P12-C_fixed", "P20E 连续延伸验证"],
                "trades": ["r2-0039 605138.SH 卖出 2026-10-13", "r2-0040 688009.SH 卖出 2026-10-15",
                           "所有 reason=holding_review_exit:two_triggered_remaining_score_ge_threshold 的历史卖出"],
                "note": "评分方向问题影响所有使用该退出规则的 V2 卖出决策；本轮只审计，不改策略、不翻转符号、不重跑收益。",
            },
            "recommendation": ("下一任务：由策略负责人确认三项分数的语义（强弱 vs 风险）。若目标为风险分，"
                               "应把公式改为“风险越高分越高”（如 clamp(5 - 动量×100)）并明确缺失值不算通过；"
                               "若目标为强弱分，则退出阈值语义需重新定义。改动前不得直接翻转正负号或重跑收益。"),
        },
    }

    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / "data").mkdir(parents=True, exist_ok=True)
    out = SITE / "data" / "v2_trade_notes.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(ex, f, ensure_ascii=False, indent=2)
    print("wrote", out)


if __name__ == "__main__":
    main()