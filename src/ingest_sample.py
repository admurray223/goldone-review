#!/usr/bin/env python3
"""
GoldOne G002A 数据摄入脚本 - 小样本验证
获取：
- stock_basic: 全市场股票基础信息
- trade_cal: 交易日历
- index_daily: 6 大指数最近一年日线
- daily: 10 只股票最近 80 个交易日不复权日线
- adj_factor: 这 10 只股票的复权因子
- corporate_actions: 这 10 只股票的公司行为
- financials: 这 10 只股票的财务数据 (最近几期)
"""
import json
import uuid
import subprocess
import duckdb
from datetime import datetime, timedelta
from pathlib import Path
import sys

DB_PATH = "data/goldone.duckdb"
RUN_ID = str(uuid.uuid4())[:8]
STARTED_AT = datetime.now()

# 目标指数
TARGET_INDICES = {
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指", 
    "399006.SZ": "创业板指",
    "000300.SH": "沪深300",
    "000852.SH": "中证1000",
    "000688.SH": "科创50",
}

# 目标个股 (3个交易所，10只，含1只退市)
TARGET_STOCKS = [
    # SH
    ("600519.SH", "贵州茅台", "SH"),
    ("600000.SH", "浦发银行", "SH"),
    ("600036.SH", "招商银行", "SH"),
    # SZ
    ("000001.SZ", "平安银行", "SZ"),
    ("000002.SZ", "万科A", "SZ"),
    ("000651.SZ", "格力电器", "SZ"),
    # BSE (北交所)
    ("834171.BJ", "金亚科技", "BJ"),
    ("833176.BJ", "斯瑞新材", "BJ"),
    # 退市股票示例 (使用已退市的股票代码)
    ("600000.SH", "浦发银行", "SH"),  # 占位，实际需要找退市股
]

# 实际上市/退市信息需要从 stock_basic 获取
# 这里先定义代码，后续会用 stock_basic 补全

def run_cmd(cmd, description):
    """运行 CLI 命令并返回结果"""
    print(f"  [{description}] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  [{description}] FAILED: {result.stderr}")
        return None
    return result.stdout

def parse_date_ms(ms):
    """毫秒时间戳转日期字符串"""
    return datetime.fromtimestamp(ms / 1000).strftime('%Y-%m-%d')

def fmt_date(date_str):
    """格式化日期字符串为 YYYY-MM-DD"""
    if not date_str:
        return None
    s = str(date_str).replace('-', '')
    if len(s) == 8:
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return date_str

def get_trade_calendar():
    """获取交易日历"""
    print("\n=== 获取交易日历 ===")
    cmd = ["hithink-finance", "market", "calendar", "--format", "json"]
    stdout = run_cmd(cmd, "market calendar")
    if not stdout:
        return []
    data = json.loads(stdout)
    cal_items = data.get("data", {}).get("item", [])
    print(f"  获取到 {len(cal_items)} 条交易日历记录")
    return cal_items

def get_stock_basic():
    """获取股票基础信息（分页获取全市场）"""
    print("\n=== 获取股票基础信息 ===")
    all_stocks = []
    offset = 0
    limit = 1000
    while True:
        cmd = ["hithink-finance", "symbol", "list", 
               "--exchange", "SH,SZ,BJ",
               "--asset-type", "a-share",
               "--limit", str(limit),
               "--offset", str(offset),
               "--format", "json"]
        stdout = run_cmd(cmd, f"symbol list offset={offset}")
        if not stdout:
            break
        data = json.loads(stdout)
        items = data.get("data", {}).get("item", [])
        if not items:
            break
        all_stocks.extend(items)
        print(f"  获取到 {len(items)} 条，累计 {len(all_stocks)} 条")
        if len(items) < limit:
            break
        offset += limit
    print(f"  总计获取 {len(all_stocks)} 只股票")
    return all_stocks

def get_index_history(thscode, start_ms, end_ms):
    """获取指数历史日线"""
    cmd = ["hithink-finance", "index", "history",
           "--thscode", thscode,
           "--start-ms", str(start_ms),
           "--end-ms", str(end_ms),
           "--format", "json"]
    stdout = run_cmd(cmd, f"index history {thscode}")
    if not stdout:
        return []
    data = json.loads(stdout)
    return data.get("data", {}).get("item", [])

def get_stock_history(thscode, start_ms, end_ms, adjust="none"):
    """获取个股历史日线"""
    cmd = ["hithink-finance", "market", "history",
           "--thscode", thscode,
           "--start-ms", str(start_ms),
           "--end-ms", str(end_ms),
           "--adjust", adjust,
           "--format", "json"]
    stdout = run_cmd(cmd, f"market history {thscode}")
    if not stdout:
        return []
    data = json.loads(stdout)
    return data.get("data", {}).get("item", [])

def get_adj_factors(thscode):
    """获取复权因子 (本地库)"""
    cmd = ["hithink-finance", "market", "adjustment-factors",
           "--thscode", thscode,
           "--format", "json"]
    stdout = run_cmd(cmd, f"adj factors {thscode}")
    if not stdout:
        return []
    data = json.loads(stdout)
    # 本地库返回 data 可能是数组或对象
    d = data.get("data", [])
    if isinstance(d, list):
        return d
    return d.get("item", [])

def get_corporate_actions(thscode, from_date, to_date):
    """获取公司行为"""
    cmd = ["hithink-finance", "market", "corporate-actions",
           "--thscode", thscode,
           "--from-date", from_date,
           "--to-date", to_date,
           "--format", "json"]
    stdout = run_cmd(cmd, f"corporate actions {thscode}")
    if not stdout:
        return []
    data = json.loads(stdout)
    items = data.get("data", {}).get("item", [])
    # 转换 ex_date_ms 为 ex_date
    for item in items:
        if item.get("ex_date_ms"):
            item["ex_date"] = parse_date_ms(item["ex_date_ms"])
        if item.get("record_date_ms"):
            item["record_date"] = parse_date_ms(item["record_date_ms"])
        if item.get("pay_date_ms"):
            item["pay_date"] = parse_date_ms(item["pay_date_ms"])
        # 映射字段名
        if item.get("per_share_bonus") is not None:
            item["bonus_ratio"] = item["per_share_bonus"]
        if item.get("per_share_split") is not None:
            item["split_ratio"] = item["per_share_split"]
    return items

def get_financials(thscode, report_type="quarterly"):
    """获取财务数据"""
    # 财务数据需要具体的报告期，这里尝试获取最近几期
    results = {}
    for endpoint in ["income", "balance-sheet", "cash-flow", "indicators"]:
        cmd = ["hithink-finance", "financials", endpoint,
               "--thscode", thscode,
               "--format", "json"]
        stdout = run_cmd(cmd, f"financials {endpoint} {thscode}")
        if stdout:
            data = json.loads(stdout)
            results[endpoint] = data.get("data", {}).get("item", [])
    return results

def main():
    conn = duckdb.connect(DB_PATH)
    
    # 记录 ingestion_run
    conn.execute("""
        INSERT INTO ingestion_runs (run_id, run_type, target, status, started_at, config_snapshot)
        VALUES (?, 'sample', 'all', 'running', ?, ?)
    """, [RUN_ID, STARTED_AT, json.dumps({
        "target_indices": list(TARGET_INDICES.keys()),
        "target_stocks": [s[0] for s in TARGET_STOCKS],
    })])
    
    api_calls = 0
    rows_inserted = 0
    
    try:
        # 1. 获取交易日历
        cal_items = get_trade_calendar()
        api_calls += 1
        for item in cal_items:
            # 解析交易日历字段
            exchange = item.get("exchange", "")
            cal_date_raw = item.get("date", "")  # 可能是 date 或 cal_date，格式 YYYYMMDD
            # 转换为 YYYY-MM-DD
            if cal_date_raw and len(cal_date_raw) == 8:
                cal_date = f"{cal_date_raw[:4]}-{cal_date_raw[4:6]}-{cal_date_raw[6:8]}"
            else:
                cal_date = cal_date_raw
            is_open = item.get("is_open", True)
            pretrade_raw = item.get("pretrade_date")
            nexttrade_raw = item.get("nexttrade_date")
            pretrade = f"{pretrade_raw[:4]}-{pretrade_raw[4:6]}-{pretrade_raw[6:8]}" if pretrade_raw and len(pretrade_raw) == 8 else pretrade_raw
            nexttrade = f"{nexttrade_raw[:4]}-{nexttrade_raw[4:6]}-{nexttrade_raw[6:8]}" if nexttrade_raw and len(nexttrade_raw) == 8 else nexttrade_raw
            
            conn.execute("""
                INSERT OR REPLACE INTO trade_cal 
                (exchange, cal_date, is_open, pretrade_date, nexttrade_date, data_source, retrieved_at, ingestion_run_id)
                VALUES (?, ?, ?, ?, ?, 'hithink', ?, ?)
            """, [exchange, cal_date, is_open, pretrade, nexttrade, datetime.now(), RUN_ID])
            rows_inserted += 1
        
        # 2. 获取股票基础信息
        stocks = get_stock_basic()
        api_calls += 1  # 算作一次批量调用
        for stock in stocks:
            thscode = stock.get("thscode", "")
            list_date = fmt_date(stock.get("list_date"))
            delist_date = fmt_date(stock.get("end_date"))
            conn.execute("""
                INSERT OR REPLACE INTO stock_basic
                (ts_code, thscode, name, industry, industry_code, area, market, 
                 list_date, delist_date, list_status, is_hs, 
                 data_source, retrieved_at, ingestion_run_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?, ?)
            """, [
                thscode, thscode, stock.get("name", ""), None, None, None, stock.get("exchange", ""),
                list_date, delist_date, "L" if not delist_date else "D", False,
                datetime.now(), RUN_ID, datetime.now()
            ])
            rows_inserted += 1
        
        # 确定时间范围：最近 80 个交易日约等于 120 个自然日
        end_date = datetime.now()
        start_date = end_date - timedelta(days=180)  # 留足缓冲
        start_ms = int(start_date.timestamp() * 1000)
        end_ms = int(end_date.timestamp() * 1000)
        
        # 3. 获取指数日线
        print("\n=== 获取指数日线 ===")
        for thscode, name in TARGET_INDICES.items():
            items = get_index_history(thscode, start_ms, end_ms)
            api_calls += 1
            for item in items:
                conn.execute("""
                    INSERT OR REPLACE INTO index_daily
                    (ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, volume, amount,
                     data_source, retrieved_at, ingestion_run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?)
                """, [
                    thscode,
                    parse_date_ms(item.get("date_ms", 0)),
                    item.get("open_price"), item.get("high_price"), item.get("low_price"), item.get("close_price"),
                    item.get("pre_close_price"), item.get("change"), item.get("pct_chg"),
                    item.get("volume"), item.get("turnover"),
                    datetime.now(), RUN_ID
                ])
                rows_inserted += 1
            print(f"  {name} ({thscode}): {len(items)} 条")
        
        # 4. 获取个股日线、复权因子、公司行为
        print("\n=== 获取个股数据 ===")
        stock_codes = [s[0] for s in TARGET_STOCKS]
        for thscode in stock_codes:
            # 不复权日线
            items = get_stock_history(thscode, start_ms, end_ms, adjust="none")
            api_calls += 1
            for item in items:
                conn.execute("""
                    INSERT OR REPLACE INTO daily
                    (ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, volume, amount,
                     data_source, retrieved_at, ingestion_run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?)
                """, [
                    thscode,
                    parse_date_ms(item.get("date_ms", 0)),
                    item.get("open_price"), item.get("high_price"), item.get("low_price"), item.get("close_price"),
                    item.get("pre_close_price"), item.get("change"), item.get("pct_chg"),
                    item.get("volume"), item.get("turnover"),
                    datetime.now(), RUN_ID
                ])
                rows_inserted += 1
            print(f"  {thscode} daily: {len(items)} 条")
            
            # 复权因子
            adj_items = get_adj_factors(thscode)
            for item in adj_items:
                conn.execute("""
                    INSERT OR REPLACE INTO adj_factor
                    (ts_code, trade_date, adj_factor, data_source, retrieved_at, ingestion_run_id)
                    VALUES (?, ?, ?, 'hithink', ?, ?)
                """, [
                    thscode,
                    fmt_date(item.get("trade_date")),
                    item.get("adj_factor"),
                    datetime.now(), RUN_ID
                ])
                rows_inserted += 1
            print(f"  {thscode} adj_factor: {len(adj_items)} 条")
            
            # 公司行为
            ca_items = get_corporate_actions(thscode, start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
            api_calls += 1
            for item in ca_items:
                conn.execute("""
                    INSERT OR REPLACE INTO corporate_actions
                    (ts_code, ex_date, record_date, pay_date, dividend_per_share, bonus_ratio, split_ratio,
                     action_type, source_record_id, data_source, retrieved_at, ingestion_run_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?)
                """, [
                    thscode,
                    fmt_date(item.get("ex_date")), fmt_date(item.get("record_date")), fmt_date(item.get("pay_date")),
                    item.get("dividend_per_share"), item.get("bonus_ratio"), item.get("split_ratio"),
                    item.get("action_type", "dividend"),
                    item.get("source_record_id", f"{thscode}_{item.get('ex_date')}"),
                    datetime.now(), RUN_ID
                ])
                rows_inserted += 1
            print(f"  {thscode} corporate_actions: {len(ca_items)} 条")
            
            # 财务数据 (可选，较慢)
            # fin_data = get_financials(thscode)
            # ... 解析并入库
        
        # 更新 ingestion_run 完成
        conn.execute("""
            UPDATE ingestion_runs 
            SET status='completed', completed_at=?, api_calls=?, rows_inserted=?, data_as_of=?
            WHERE run_id=?
        """, [datetime.now(), api_calls, rows_inserted, end_date.strftime('%Y-%m-%d'), RUN_ID])
        
        print(f"\n=== 摄入完成 ===")
        print(f"  Run ID: {RUN_ID}")
        print(f"  API 调用: {api_calls}")
        print(f"  插入行数: {rows_inserted}")
        
    except Exception as e:
        print(f"\n=== 摄入失败 ===")
        print(f"  Error: {e}")
        conn.execute("""
            UPDATE ingestion_runs 
            SET status='failed', completed_at=?, error_message=?, api_calls=?, rows_inserted=?
            WHERE run_id=?
        """, [datetime.now(), str(e), api_calls, rows_inserted, RUN_ID])
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    main()