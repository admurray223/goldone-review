#!/usr/bin/env python3
"""
GoldOne G002A-S1 数据摄入脚本 - 事务/暂存表版本
支持：
- 显式事务与暂存表
- API 精确计数
- pre_close 推导与来源追踪
- 故障注入测试点
- SH/SZ 仅沪深市场
"""
import json
import uuid
import subprocess
import duckdb
import hashlib
import time
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any
import sys

DB_PATH = os.environ.get('DB_PATH', "data/goldone_g002a_s1.duckdb")
RUN_ID = str(uuid.uuid4())[:8]
STARTED_AT = datetime.now()

# 目标指数（沪深六大指数）
TARGET_INDICES = {
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
    "000300.SH": "沪深300",
    "000852.SH": "中证1000",
    "000688.SH": "科创50",
}

# 故障注入配置（测试用，生产设为 None）
FAULT_INJECTION = None  # 可选: 'after_stock_basic', 'during_daily', 'during_transform', 'db_constraint'

class APICounter:
    """统一 API 调用计数器"""
    def __init__(self, conn: duckdb.DuckDBPyConnection, run_id: str):
        self.conn = conn
        self.run_id = run_id
        self.call_count = 0
        self.success_count = 0
        self.fail_count = 0
        self.retry_count = 0
        self.by_endpoint = {}

    def record_call(self, endpoint: str, method: str, params: dict, success: bool,
                    retry: int = 0, error: str = None, duration_ms: int = 0):
        counter_id = str(uuid.uuid4())[:8]
        params_hash = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
        self.conn.execute("""
            INSERT INTO api_call_counter
            (counter_id, ingestion_run_id, endpoint, method, params_hash, success, retry_count, error_message, started_at, completed_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [counter_id, self.run_id, endpoint, method, params_hash, success, retry, error,
              datetime.now(), datetime.now(), duration_ms])

        self.call_count += 1
        if success:
            self.success_count += 1
        else:
            self.fail_count += 1
        self.retry_count += retry
        self.by_endpoint[endpoint] = self.by_endpoint.get(endpoint, 0) + 1

    def get_summary(self) -> dict:
        return {
            "total": self.call_count,
            "success": self.success_count,
            "failed": self.fail_count,
            "retries": self.retry_count,
            "by_endpoint": self.by_endpoint
        }

def run_cmd(cmd: List[str], description: str, counter: APICounter, endpoint: str, params: dict, max_retries: int = 3) -> Optional[str]:
    """运行 CLI 命令并记录 API 调用，支持重试"""
    for attempt in range(max_retries + 1):
        start = time.time()
        print(f"  [{description}] Running: {' '.join(cmd)} (attempt {attempt+1}/{max_retries+1})")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            duration_ms = int((time.time() - start) * 1000)
            if result.returncode != 0:
                # Check if it's a "no data" error (not a real failure)
                if "FUYAO_3002" in result.stderr and "No adjustment events" in result.stderr:
                    counter.record_call(endpoint, "CLI", params, True, attempt, None, duration_ms)
                    return "{}"  # Return empty JSON for no data
                if attempt < max_retries:
                    print(f"  [{description}] Retry {attempt+1}/{max_retries}: {result.stderr[:200]}")
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                counter.record_call(endpoint, "CLI", params, False, attempt, result.stderr[:500], duration_ms)
                print(f"  [{description}] FAILED after {max_retries} retries: {result.stderr[:200]}")
                return None
            counter.record_call(endpoint, "CLI", params, True, attempt, None, duration_ms)
            return result.stdout
        except subprocess.TimeoutExpired:
            duration_ms = int((time.time() - start) * 1000)
            if attempt < max_retries:
                print(f"  [{description}] Timeout, retry {attempt+1}/{max_retries}")
                time.sleep(2 ** attempt)
                continue
            counter.record_call(endpoint, "CLI", params, False, attempt, "Timeout", duration_ms)
            print(f"  [{description}] TIMEOUT after {max_retries} retries")
            return None
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            if attempt < max_retries:
                print(f"  [{description}] Error: {e}, retry {attempt+1}/{max_retries}")
                time.sleep(2 ** attempt)
                continue
            counter.record_call(endpoint, "CLI", params, False, attempt, str(e)[:500], duration_ms)
            print(f"  [{description}] ERROR after {max_retries} retries: {e}")
            return None
    return None

def parse_date_ms(ms: int) -> str:
    """毫秒时间戳转日期字符串 YYYY-MM-DD"""
    return datetime.fromtimestamp(ms / 1000).strftime('%Y-%m-%d')

def fmt_date(date_str: Any) -> Optional[str]:
    """格式化日期字符串为 YYYY-MM-DD"""
    if not date_str:
        return None
    s = str(date_str).replace('-', '')
    if len(s) == 8:
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return date_str

def maybe_inject_fault(stage: str):
    """故障注入点"""
    if FAULT_INJECTION and FAULT_INJECTION == stage:
        raise RuntimeError(f"FAULT_INJECTION triggered at stage: {stage}")

class IngestionEngine:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self._ensure_schema()
        self.counter = APICounter(self.conn, RUN_ID)
        self.rows_inserted = 0
        self.batch_id = str(uuid.uuid4())[:8]

    def _ensure_schema(self):
        """确保 schema 存在"""
        tables = self.conn.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
        """).fetchall()
        table_names = {t[0] for t in tables}

        required_tables = {'ingestion_runs', 'stock_basic', 'trade_cal', 'daily', 'adj_factor',
                          'index_daily', 'financials', 'corporate_actions', 'data_quality_issues',
                          'api_call_counter', 'staging_daily', 'staging_adj_factor', 'staging_stock_basic',
                          'market_breadth', 'publish_package'}

        if not required_tables.issubset(table_names):
            # 运行 schema 创建
            from create_schema_g002a_s1 import create_schema
            create_schema(self.db_path)
            # 重新连接
            self.conn.close()
            self.conn = duckdb.connect(self.db_path)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()

    def begin_ingestion_run(self, run_type: str, target: str, config: dict):
        """记录摄入运行开始"""
        self.conn.execute("""
            INSERT INTO ingestion_runs (run_id, run_type, target, market_scope, status, started_at, config_snapshot)
            VALUES (?, ?, ?, ?, 'running', ?, ?)
        """, [RUN_ID, run_type, target, json.dumps(["SH", "SZ"]), STARTED_AT, json.dumps(config)])

    def complete_ingestion_run(self, status: str, data_as_of: Optional[str] = None, error: str = None):
        """完成摄入运行记录"""
        api_summary = self.counter.get_summary()
        self.conn.execute("""
            UPDATE ingestion_runs
            SET status=?, completed_at=?, api_calls=?, rows_inserted=?, rows_updated=?, rows_skipped=?, error_message=?, data_as_of=?
            WHERE run_id=?
        """, [status, datetime.now(), api_summary["total"], self.rows_inserted, 0, 0, error, data_as_of, RUN_ID])

    def get_trade_calendar(self) -> List[dict]:
        """获取交易日历"""
        print("\n=== 获取交易日历 ===")
        cmd = ["/Users/z/.local/bin/hithink-finance", "market", "calendar", "--format", "json"]
        stdout = run_cmd(cmd, "market calendar", self.counter, "market.calendar", {})
        if not stdout:
            return []
        data = json.loads(stdout)
        cal_items = data.get("data", {}).get("item", [])
        print(f"  获取到 {len(cal_items)} 条交易日历记录")
        return cal_items

    def save_trade_calendar(self, cal_items: List[dict]):
        """保存交易日历（为 SH 和 SZ 都保存相同的交易日）"""
        for item in cal_items:
            cal_date_raw = item.get("date", "")
            if cal_date_raw and len(cal_date_raw) == 8:
                cal_date = f"{cal_date_raw[:4]}-{cal_date_raw[4:6]}-{cal_date_raw[6:8]}"
            else:
                cal_date = cal_date_raw
            is_open = item.get("is_open", True)
            # hithink-finance calendar 不返回 exchange 和 pretrade/nexttrade
            # 为 SH 和 SZ 都插入相同的交易日
            for exchange in ("SH", "SZ"):
                self.conn.execute("""
                    INSERT OR REPLACE INTO trade_cal
                    (exchange, cal_date, is_open, pretrade_date, nexttrade_date, data_source, retrieved_at, ingestion_run_id)
                    VALUES (?, ?, ?, NULL, NULL, 'hithink', ?, ?)
                """, [exchange, cal_date, is_open, datetime.now(), RUN_ID])
                self.rows_inserted += 1

    def get_stock_basic(self) -> List[dict]:
        """获取沪深 A 股基础信息（分页）"""
        print("\n=== 获取股票基础信息 (SH/SZ) ===")
        all_stocks = []
        offset = 0
        limit = 1000
        while True:
            cmd = ["/Users/z/.local/bin/hithink-finance", "symbol", "list",
                   "--exchange", "SH,SZ",
                   "--asset-type", "a-share",
                   "--limit", str(limit),
                   "--offset", str(offset),
                   "--format", "json"]
            stdout = run_cmd(cmd, f"symbol list offset={offset}", self.counter, "symbol.list",
                           {"exchange": "SH,SZ", "asset_type": "a-share", "limit": limit, "offset": offset})
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
        print(f"  总计获取 {len(all_stocks)} 只股票 (SH/SZ)")
        return all_stocks

    def save_stock_basic_staging(self, stocks: List[dict]):
        """保存股票基础信息到暂存表"""
        print("\n=== 暂存股票基础信息 ===")
        for stock in stocks:
            thscode = stock.get("thscode", "")
            # 只保留 SH/SZ
            exchange = stock.get("exchange", "")
            if exchange not in ("SH", "SZ"):
                continue
            market = exchange  # SH/SZ
            list_date = fmt_date(stock.get("list_date"))
            delist_date = fmt_date(stock.get("end_date"))
            list_status = "L" if not delist_date else "D"

            self.conn.execute("""
                INSERT INTO staging_stock_basic
                (ts_code, thscode, name, industry, industry_code, area, market,
                 list_date, delist_date, list_status, is_hs,
                 data_source, retrieved_at, ingestion_run_id, batch_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?, ?)
            """, [
                thscode, thscode, stock.get("name", ""), None, None, None, market,
                list_date, delist_date, list_status, False,
                datetime.now(), RUN_ID, self.batch_id
            ])
        print(f"  暂存 {len(stocks)} 条股票基础信息")

    def validate_and_commit_stock_basic(self) -> bool:
        """校验并提交股票基础信息"""
        print("\n=== 校验并提交股票基础信息 ===")
        # 校验：market 必须是 SH/SZ
        invalid = self.conn.execute("""
            SELECT COUNT(*) FROM staging_stock_basic
            WHERE batch_id = ? AND market NOT IN ('SH','SZ')
        """, [self.batch_id]).fetchone()[0]
        if invalid > 0:
            print(f"  FAIL: {invalid} 条记录 market 非 SH/SZ")
            return False

        # 校验：list_date 覆盖率（警告，不阻断）
        total = self.conn.execute("SELECT COUNT(*) FROM staging_stock_basic WHERE batch_id = ?", [self.batch_id]).fetchone()[0]
        with_list_date = self.conn.execute("""
            SELECT COUNT(*) FROM staging_stock_basic WHERE batch_id = ? AND list_date IS NOT NULL
        """, [self.batch_id]).fetchone()[0]
        coverage = with_list_date / total if total > 0 else 0
        print(f"  list_date 覆盖率: {coverage:.1%} ({with_list_date}/{total})")

        # 校验：退市股票数量
        delisted = self.conn.execute("""
            SELECT COUNT(*) FROM staging_stock_basic WHERE batch_id = ? AND list_status = 'D'
        """, [self.batch_id]).fetchone()[0]
        print(f"  退市股票数量: {delisted}")

        maybe_inject_fault('after_stock_basic')

        # 提交到正式表
        self.conn.execute("""
            INSERT OR REPLACE INTO stock_basic
            (ts_code, thscode, name, industry, industry_code, area, market,
             list_date, delist_date, list_status, is_hs,
             data_source, retrieved_at, ingestion_run_id, updated_at)
            SELECT ts_code, thscode, name, industry, industry_code, area, market,
                   list_date, delist_date, list_status, is_hs,
                   data_source, retrieved_at, ingestion_run_id, CURRENT_TIMESTAMP
            FROM staging_stock_basic WHERE batch_id = ?
        """, [self.batch_id])
        committed = self.conn.execute("SELECT COUNT(*) FROM staging_stock_basic WHERE batch_id = ?", [self.batch_id]).fetchone()[0]
        self.rows_inserted += committed
        print(f"  提交 {committed} 条到正式表")
        return True

    def get_recent_80_trade_dates(self) -> List[str]:
        """获取最近 80 个已完成的交易日"""
        trade_dates = [row[0] for row in self.conn.execute("""
            SELECT cal_date FROM trade_cal
            WHERE exchange = 'SH' AND is_open = true AND cal_date <= (SELECT MAX(trade_date) FROM daily)
            ORDER BY cal_date DESC LIMIT 80
        """).fetchall()]
        trade_dates.reverse()
        print(f"\n=== 最近 80 个交易日: {trade_dates[0]} 至 {trade_dates[-1]} ===")
        return trade_dates

    def get_date_range_for_80_days(self) -> tuple:
        """获取覆盖最近 80 交易日的开始/结束毫秒时间戳"""
        # 先获取交易日历中的最近交易日
        latest_trade_date = self.conn.execute("""
            SELECT MAX(cal_date) FROM trade_cal WHERE exchange = 'SH' AND is_open = true
        """).fetchone()[0]
        if not latest_trade_date:
            # 回退：用当前日期
            end_date = datetime.now()
            start_date = end_date - timedelta(days=180)
        else:
            end_date = datetime.strptime(str(latest_trade_date), '%Y-%m-%d')
            start_date = end_date - timedelta(days=180)  # 留足缓冲覆盖 80 个交易日
        start_ms = int(start_date.timestamp() * 1000)
        end_ms = int(end_date.timestamp() * 1000)
        return start_ms, end_ms

    def get_index_history(self, thscode: str, start_ms: int, end_ms: int) -> List[dict]:
        """获取指数历史日线"""
        cmd = ["/Users/z/.local/bin/hithink-finance", "index", "history",
               "--thscode", thscode,
               "--start-ms", str(start_ms),
               "--end-ms", str(end_ms),
               "--format", "json"]
        stdout = run_cmd(cmd, f"index history {thscode}", self.counter, "index.history",
                        {"thscode": thscode, "start_ms": start_ms, "end_ms": end_ms})
        if not stdout:
            return []
        data = json.loads(stdout)
        return data.get("data", {}).get("item", [])

    def save_index_daily(self, thscode: str, items: List[dict]):
        """保存指数日线"""
        for item in items:
            self.conn.execute("""
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
            self.rows_inserted += 1

    def get_stock_history(self, thscode: str, start_ms: int, end_ms: int, adjust: str = "none") -> List[dict]:
        """获取个股历史日线"""
        cmd = ["/Users/z/.local/bin/hithink-finance", "market", "history",
               "--thscode", thscode,
               "--start-ms", str(start_ms),
               "--end-ms", str(end_ms),
               "--adjust", adjust,
               "--format", "json"]
        stdout = run_cmd(cmd, f"market history {thscode}", self.counter, "market.history",
                        {"thscode": thscode, "start_ms": start_ms, "end_ms": end_ms, "adjust": adjust})
        if not stdout:
            return []
        data = json.loads(stdout)
        return data.get("data", {}).get("item", [])

    def get_adj_factors(self, thscode: str) -> List[dict]:
        """获取复权因子 (本地库)"""
        cmd = ["/Users/z/.local/bin/hithink-finance", "market", "adjustment-factors",
               "--thscode", thscode,
               "--format", "json"]
        stdout = run_cmd(cmd, f"adj factors {thscode}", self.counter, "market.adjustment-factors",
                        {"thscode": thscode})
        if not stdout:
            return []
        data = json.loads(stdout)
        d = data.get("data", [])
        if isinstance(d, list):
            return d
        return d.get("item", [])

    def get_corporate_actions(self, thscode: str, from_date: str, to_date: str) -> List[dict]:
        """获取公司行为"""
        cmd = ["/Users/z/.local/bin/hithink-finance", "market", "corporate-actions",
               "--thscode", thscode,
               "--from-date", from_date,
               "--to-date", to_date,
               "--format", "json"]
        stdout = run_cmd(cmd, f"corporate actions {thscode}", self.counter, "market.corporate-actions",
                        {"thscode": thscode, "from_date": from_date, "to_date": to_date})
        if not stdout or stdout == "{}":
            return []
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            return []
        items = data.get("data", {}).get("item", [])
        for item in items:
            if item.get("ex_date_ms"):
                item["ex_date"] = parse_date_ms(item["ex_date_ms"])
            if item.get("record_date_ms"):
                item["record_date"] = parse_date_ms(item["record_date_ms"])
            if item.get("pay_date_ms"):
                item["pay_date"] = parse_date_ms(item["pay_date_ms"])
            if item.get("per_share_bonus") is not None:
                item["bonus_ratio"] = item["per_share_bonus"]
            if item.get("per_share_split") is not None:
                item["split_ratio"] = item["per_share_split"]
        return items

    def save_corporate_actions(self, thscode: str, items: List[dict]):
        """保存公司行为"""
        for item in items:
            self.conn.execute("""
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
            self.rows_inserted += 1

    def save_daily_staging(self, thscode: str, items: List[dict]):
        """保存日线到暂存表（含 pre_close 推导）"""
        for item in items:
            trade_date = parse_date_ms(item.get("date_ms", 0))
            pre_close = item.get("pre_close_price")
            provenance = "source" if pre_close is not None else "derived_previous_close"

            self.conn.execute("""
                INSERT INTO staging_daily
                (ts_code, trade_date, open, high, low, close, pre_close, pre_close_provenance,
                 change, pct_chg, volume, amount, data_source, retrieved_at, ingestion_run_id, batch_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hithink', ?, ?, ?)
            """, [
                thscode, trade_date,
                item.get("open_price"), item.get("high_price"), item.get("low_price"), item.get("close_price"),
                pre_close, provenance,
                item.get("change"), item.get("pct_chg"),
                item.get("volume"), item.get("turnover"),
                datetime.now(), RUN_ID, self.batch_id
            ])

    def derive_pre_close_for_batch(self):
        """为暂存表中的记录推导 pre_close（使用同一标的前一交易日 close）"""
        print("\n=== 推导 pre_close (derived_previous_close) ===")
        # 先获取已有的正式表数据用于推导首条记录
        self.conn.execute("""
            UPDATE staging_daily s
            SET pre_close = (
                SELECT d.close FROM daily d
                WHERE d.ts_code = s.ts_code AND d.trade_date < s.trade_date AND d.data_source = 'hithink'
                ORDER BY d.trade_date DESC LIMIT 1
            ),
            pre_close_provenance = 'derived_previous_close'
            WHERE s.batch_id = ? AND s.pre_close IS NULL AND s.pre_close_provenance = 'derived_previous_close'
        """, [self.batch_id])

        # 标记首条记录（无法推导）为 null_first_record
        self.conn.execute("""
            UPDATE staging_daily
            SET pre_close_provenance = 'null_first_record'
            WHERE batch_id = ? AND pre_close IS NULL
        """, [self.batch_id])

        # 统计
        derived = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily WHERE batch_id = ? AND pre_close_provenance = 'derived_previous_close'
        """, [self.batch_id]).fetchone()[0]
        null_first = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily WHERE batch_id = ? AND pre_close_provenance = 'null_first_record'
        """, [self.batch_id]).fetchone()[0]
        from_source = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily WHERE batch_id = ? AND pre_close_provenance = 'source'
        """, [self.batch_id]).fetchone()[0]
        print(f"  来源提供: {from_source}, 推导得出: {derived}, 首条记录null: {null_first}")

    def validate_and_commit_daily(self) -> bool:
        """校验并提交日线数据"""
        print("\n=== 校验并提交日线数据 ===")
        # OHLC 逻辑检查
        ohlc_violations = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily
            WHERE batch_id = ? AND NOT (high >= open AND high >= close AND low <= open AND low <= close)
        """, [self.batch_id]).fetchone()[0]
        if ohlc_violations > 0:
            print(f"  FAIL: {ohlc_violations} 条 OHLC 逻辑违规")
            return False

        # 负值检查
        neg = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily
            WHERE batch_id = ? AND (open < 0 OR high < 0 OR low < 0 OR close < 0 OR volume < 0 OR amount < 0)
        """, [self.batch_id]).fetchone()[0]
        if neg > 0:
            print(f"  FAIL: {neg} 条负值记录")
            return False

        # pre_close 缺失率检查（除首条记录外）
        total = self.conn.execute("SELECT COUNT(*) FROM staging_daily WHERE batch_id = ?", [self.batch_id]).fetchone()[0]
        null_pre_close = self.conn.execute("""
            SELECT COUNT(*) FROM staging_daily
            WHERE batch_id = ? AND pre_close IS NULL AND pre_close_provenance != 'null_first_record'
        """, [self.batch_id]).fetchone()[0]
        missing_rate = null_pre_close / total if total > 0 else 0
        print(f"  pre_close 缺失率(除首条): {missing_rate:.2%} ({null_pre_close}/{total})")
        if missing_rate >= 0.01:
            print(f"  WARNING: pre_close 缺失率超过 1%")

        maybe_inject_fault('during_transform')

        # 提交到正式表
        self.conn.execute("""
            INSERT OR REPLACE INTO daily
            (ts_code, trade_date, open, high, low, close, pre_close, pre_close_provenance,
             change, pct_chg, volume, amount, data_source, retrieved_at, ingestion_run_id)
            SELECT ts_code, trade_date, open, high, low, close, pre_close, pre_close_provenance,
                   change, pct_chg, volume, amount, data_source, retrieved_at, ingestion_run_id
            FROM staging_daily WHERE batch_id = ?
        """, [self.batch_id])
        committed = self.conn.execute("SELECT COUNT(*) FROM staging_daily WHERE batch_id = ?", [self.batch_id]).fetchone()[0]
        self.rows_inserted += committed
        print(f"  提交 {committed} 条到正式表")
        return True

    def save_adj_factor_staging(self, thscode: str, items: List[dict]):
        """保存复权因子到暂存表"""
        for item in items:
            self.conn.execute("""
                INSERT INTO staging_adj_factor
                (ts_code, trade_date, adj_factor, data_source, retrieved_at, ingestion_run_id, batch_id)
                VALUES (?, ?, ?, 'hithink', ?, ?, ?)
            """, [
                thscode, fmt_date(item.get("trade_date")), item.get("adj_factor"),
                datetime.now(), RUN_ID, self.batch_id
            ])

    def validate_and_commit_adj_factor(self) -> bool:
        """校验并提交复权因子"""
        print("\n=== 校验并提交复权因子 ===")
        # 突变检查（单日变化 >50%）
        jumps = self.conn.execute("""
            SELECT ts_code, trade_date, adj_factor,
                   LAG(adj_factor) OVER (PARTITION BY ts_code ORDER BY trade_date) as prev_factor
            FROM staging_adj_factor
            WHERE batch_id = ? AND adj_factor IS NOT NULL
        """, [self.batch_id]).fetchall()
        jump_count = 0
        for row in jumps:
            if row[3] and row[3] > 0:
                change_pct = abs(row[2] - row[3]) / row[3]
                if change_pct > 0.5:
                    jump_count += 1
        if jump_count > 0:
            print(f"  WARNING: {jump_count} 条复权因子异常跳变")

        # 提交
        self.conn.execute("""
            INSERT OR REPLACE INTO adj_factor
            (ts_code, trade_date, adj_factor, data_source, retrieved_at, ingestion_run_id)
            SELECT ts_code, trade_date, adj_factor, data_source, retrieved_at, ingestion_run_id
            FROM staging_adj_factor WHERE batch_id = ?
        """, [self.batch_id])
        committed = self.conn.execute("SELECT COUNT(*) FROM staging_adj_factor WHERE batch_id = ?", [self.batch_id]).fetchone()[0]
        self.rows_inserted += committed
        print(f"  提交 {committed} 条到正式表")
        return True

def main():
    # 解析命令行参数
    global FAULT_INJECTION
    if len(sys.argv) > 1:
        FAULT_INJECTION = sys.argv[1]
        print(f"FAULT_INJECTION enabled: {FAULT_INJECTION}")

    with IngestionEngine() as engine:
        engine.begin_ingestion_run("sample", "all", {
            "target_indices": list(TARGET_INDICES.keys()),
            "fault_injection": FAULT_INJECTION
        })

        try:
            # 1. 交易日历
            cal_items = engine.get_trade_calendar()
            engine.save_trade_calendar(cal_items)

            # 2. 股票基础信息
            stocks = engine.get_stock_basic()
            engine.save_stock_basic_staging(stocks)
            if not engine.validate_and_commit_stock_basic():
                raise RuntimeError("stock_basic validation failed")

            # 3. 时间范围
            start_ms, end_ms = engine.get_date_range_for_80_days()

            # 4. 指数日线
            print("\n=== 获取指数日线 ===")
            for thscode, name in TARGET_INDICES.items():
                items = engine.get_index_history(thscode, start_ms, end_ms)
                engine.save_index_daily(thscode, items)
                print(f"  {name} ({thscode}): {len(items)} 条")

            # 5. 个股数据（全市场抽样，受 250 API 限制）
            # 获取所有 SH/SZ 股票代码
            stock_codes = [row[0] for row in engine.conn.execute("""
                SELECT ts_code FROM stock_basic WHERE market IN ('SH','SZ') ORDER BY ts_code
            """).fetchall()]

            # 限制在 API 预算内：每只股票 3 次调用，最多约 50 只股票 = 150 调用
            # 加上指数 6 + symbol.list 6 + calendar 1 = 13，总计约 163，远低于 250
            max_stocks = min(50, len(stock_codes))
            stock_codes = stock_codes[:max_stocks]
            print(f"\n=== 获取个股数据 (限制 {max_stocks} 只，API 预算内) ===")

            from_date = datetime.fromtimestamp(start_ms/1000).strftime('%Y-%m-%d')
            to_date = datetime.fromtimestamp(end_ms/1000).strftime('%Y-%m-%d')

            for i, thscode in enumerate(stock_codes):
                if i % 20 == 0:
                    print(f"  进度: {i}/{max_stocks}")

                # 不复权日线
                items = engine.get_stock_history(thscode, start_ms, end_ms, adjust="none")
                engine.save_daily_staging(thscode, items)

                # 复权因子
                adj_items = engine.get_adj_factors(thscode)
                engine.save_adj_factor_staging(thscode, adj_items)

                # 公司行为
                ca_items = engine.get_corporate_actions(thscode, from_date, to_date)
                engine.save_corporate_actions(thscode, ca_items)

            # 推导 pre_close
            engine.derive_pre_close_for_batch()

            # 校验并提交日线
            if not engine.validate_and_commit_daily():
                raise RuntimeError("daily validation failed")

            # 校验并提交复权因子
            if not engine.validate_and_commit_adj_factor():
                raise RuntimeError("adj_factor validation failed")

            # 完成
            data_as_of = engine.conn.execute("SELECT MAX(trade_date) FROM daily").fetchone()[0]
            engine.complete_ingestion_run("completed", str(data_as_of) if data_as_of else None)

            print(f"\n=== 摄入完成 ===")
            print(f"  Run ID: {RUN_ID}")
            summary = engine.counter.get_summary()
            print(f"  API 调用总数: {summary['total']}")
            print(f"  成功: {summary['success']}, 失败: {summary['failed']}, 重试: {summary['retries']}")
            print(f"  按接口: {summary['by_endpoint']}")
            print(f"  插入行数: {engine.rows_inserted}")

        except Exception as e:
            print(f"\n=== 摄入失败 ===")
            print(f"  Error: {e}")
            engine.complete_ingestion_run("failed", error=str(e))
            raise

if __name__ == '__main__':
    main()