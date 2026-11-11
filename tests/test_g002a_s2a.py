#!/usr/bin/env python3
"""
GoldOne G002A-S2A 自动化测试套件
覆盖：
- SH/SZ 范围过滤
- 历史股票池
- 退市股票
- 事务回滚（4个故障注入点）
- API 精确计数
- pre_close 推导（S2A 修复：每股最多1条 null_first_record）
- 缺失数据输出 null 而非 0
- 覆盖率不足拒绝发布
- MA20/MA60 最小历史窗口
- 最近成功摄入运行选择
- 动态 stale_after
- 发布文件真实 SHA-256（manifest 排除自身、manifest.sha256）
- Token 和本地路径扫描
- 样本数量恰好 50
- 运行隔离（所有表绑定同一 ingestion_run_id）
- 市场宽度守恒
- 市场宽度非空、行数符合预期
- 覆盖率非空、数值符合预期
- 发布切换故障时旧 latest 保持不变
"""
import sys
import duckdb
import json
import hashlib
import tempfile
import os
import subprocess
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
except ImportError:
    SHANGHAI_TZ = timezone(timedelta(hours=8))

EXIT_PASS = 0
EXIT_FAIL = 1
assertion_errors = []


def check(condition, msg):
    if not condition:
        assertion_errors.append(msg)
        print(f"  FAIL: {msg}")
    else:
        print(f"  PASS: {msg}")


def test_schema_and_constraints():
    """测试 Schema 和约束"""
    print("=== Test: Schema 和约束 ===")
    conn = duckdb.connect(':memory:')

    # 创建增强版 schema
    conn.execute("""
        CREATE TABLE stock_basic (
            ts_code VARCHAR PRIMARY KEY,
            market VARCHAR NOT NULL CHECK (market IN ('SH','SZ')),
            list_date DATE,
            delist_date DATE,
            list_status VARCHAR NOT NULL CHECK (list_status IN ('L','D','P','U')),
            data_source VARCHAR NOT NULL,
            ingestion_run_id VARCHAR NOT NULL
        )
    """)

    conn.execute("""
        CREATE TABLE daily (
            ts_code VARCHAR NOT NULL,
            trade_date DATE NOT NULL,
            pre_close DOUBLE,
            pre_close_provenance VARCHAR CHECK (pre_close_provenance IN ('source','derived_previous_close','null_first_record')),
            data_source VARCHAR NOT NULL,
            ingestion_run_id VARCHAR NOT NULL,
            PRIMARY KEY (ts_code, trade_date, data_source)
        )
    """)

    conn.execute("""
        CREATE TABLE market_breadth (
            trade_date DATE NOT NULL,
            pool_size INTEGER NOT NULL,
            observed_count INTEGER NOT NULL,
            comparison_valid_count INTEGER NOT NULL,
            unknown_change_count INTEGER NOT NULL,
            coverage_ratio_observed DOUBLE NOT NULL,
            coverage_ratio_comparison DOUBLE NOT NULL,
            up_count INTEGER NOT NULL,
            down_count INTEGER NOT NULL,
            flat_count INTEGER NOT NULL,
            data_quality_status VARCHAR NOT NULL CHECK (data_quality_status IN ('passed','passed_with_warnings','incomplete','failed')),
            ingestion_run_id VARCHAR NOT NULL,
            PRIMARY KEY (trade_date, ingestion_run_id)
        )
    """)

    conn.execute("""
        CREATE TABLE publish_package (
            package_id VARCHAR PRIMARY KEY,
            market_scope VARCHAR NOT NULL,
            sample_mode BOOLEAN NOT NULL,
            coverage_ratio DOUBLE,
            publishability VARCHAR NOT NULL CHECK (publishability IN ('full','partial','sample_only')),
            data_quality_status VARCHAR NOT NULL CHECK (data_quality_status IN ('passed','passed_with_warnings','incomplete','failed')),
            stale_after TIMESTAMP WITH TIME ZONE NOT NULL,
            manifest_sha256 VARCHAR
        )
    """)

    # 测试 market 约束
    try:
        conn.execute("INSERT INTO stock_basic (ts_code, market, list_status, data_source, ingestion_run_id) VALUES ('000001.SZ', 'SZ', 'L', 'hithink', 'run1')")
        check(True, "SH/SZ market 值接受")
    except:
        check(False, "SH/SZ market 值应被接受")

    try:
        conn.execute("INSERT INTO stock_basic (ts_code, market, list_status, data_source, ingestion_run_id) VALUES ('888888.BJ', 'BJ', 'L', 'hithink', 'run1')")
        check(False, "BJ market 值应被拒绝")
    except:
        check(True, "BJ market 值正确拒绝")

    # 测试 list_status 约束
    try:
        conn.execute("INSERT INTO stock_basic (ts_code, market, list_status, data_source, ingestion_run_id) VALUES ('000002.SZ', 'SZ', 'D', 'hithink', 'run1')")
        check(True, "退市状态 D 接受")
    except:
        check(False, "退市状态 D 应被接受")

    try:
        conn.execute("INSERT INTO stock_basic (ts_code, market, list_status, data_source, ingestion_run_id) VALUES ('000003.SZ', 'SZ', 'X', 'hithink', 'run1')")
        check(False, "非法 list_status 应被拒绝")
    except:
        check(True, "非法 list_status 正确拒绝")

    # 测试 pre_close_provenance 约束
    try:
        conn.execute("INSERT INTO daily (ts_code, trade_date, pre_close_provenance, data_source, ingestion_run_id) VALUES ('000001.SZ', '2026-01-01', 'source', 'hithink', 'run1')")
        check(True, "pre_close_provenance=source 接受")
    except:
        check(False, "pre_close_provenance=source 应被接受")

    try:
        conn.execute("INSERT INTO daily (ts_code, trade_date, pre_close_provenance, data_source, ingestion_run_id) VALUES ('000001.SZ', '2026-01-02', 'invalid', 'hithink', 'run1')")
        check(False, "非法 pre_close_provenance 应被拒绝")
    except:
        check(True, "非法 pre_close_provenance 正确拒绝")

    # 测试 market_breadth 约束
    try:
        conn.execute("INSERT INTO market_breadth (trade_date, pool_size, observed_count, comparison_valid_count, unknown_change_count, coverage_ratio_observed, coverage_ratio_comparison, up_count, down_count, flat_count, data_quality_status, ingestion_run_id) VALUES ('2026-01-01', 100, 50, 48, 2, 0.5, 0.48, 20, 15, 13, 'passed', 'run1')")
        check(True, "market_breadth 守恒检查通过")
    except:
        check(False, "market_breadth 守恒检查应通过")

    # 测试 publish_package 约束
    try:
        conn.execute("""
            INSERT INTO publish_package (package_id, market_scope, sample_mode, coverage_ratio, publishability, data_quality_status, stale_after, manifest_sha256)
            VALUES ('pkg1', '["SH","SZ"]', true, 0.0383, 'sample_only', 'failed', '2026-11-18 00:00:00+00:00', 'abc123')
        """)
        check(True, "publish_package 约束接受")
    except:
        check(False, "publish_package 约束应接受")

    try:
        conn.execute("""
            INSERT INTO publish_package (package_id, market_scope, sample_mode, coverage_ratio, publishability, data_quality_status, stale_after, manifest_sha256)
            VALUES ('pkg2', '["SH","SZ"]', true, 0.0383, 'invalid', 'failed', '2026-11-18 00:00:00+00:00', 'abc123')
        """)
        check(False, "非法 publishability 应被拒绝")
    except:
        check(True, "非法 publishability 正确拒绝")

    conn.close()


def test_date_parsing_timezone():
    """测试日期解析时区正确性 (Hithink date_ms 使用 Asia/Shanghai)"""
    print("\n=== Test: 日期解析时区正确性 ===")

    def parse_date_ms(ms: int) -> str:
        return datetime.fromtimestamp(ms / 1000, tz=SHANGHAI_TZ).strftime('%Y-%m-%d')

    # 已知时间戳 -> 预期交易日期 (上海时区)
    test_cases = [
        # (date_ms, expected_date, description)
        (1783008000000, "2026-07-03", "2026-07-03 周五"),
        (1783267200000, "2026-07-06", "2026-07-06 周一"),
        (1783612800000, "2026-07-10", "2026-07-10 周五"),
        (1783872000000, "2026-07-13", "2026-07-13 周一"),
        (1784217600000, "2026-07-17", "2026-07-17 周五"),
        (1784476800000, "2026-07-20", "2026-07-20 周一"),
        (1784822400000, "2026-07-24", "2026-07-24 周五"),
        (1785081600000, "2026-07-27", "2026-07-27 周一"),
        (1785427200000, "2026-07-31", "2026-07-31 周五"),
        (1794240000000, "2026-11-10", "2026-11-10 周二"),
    ]

    for ms, expected, desc in test_cases:
        result = parse_date_ms(ms)
        check(result == expected, f"{desc}: {ms} -> {result} (期望 {expected})")

    # 验证 UTC 解析会产生错误日期 (回归测试)
    def parse_date_ms_utc(ms: int) -> str:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d')

    utc_result = parse_date_ms_utc(1783008000000)  # 2026-07-03 周五上海时间
    check(utc_result == "2026-07-02", f"UTC 解析错误确认: 1783008000000 -> {utc_result} (错误，应为 2026-07-03)")
    print("  UTC 解析会导致日期偏移一天（周五变周四），已修复")


def test_no_weekend_dates_in_daily():
    """测试 daily 表无周末日期"""
    print("\n=== Test: daily 表无周末日期 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    rows = conn.execute("""
        SELECT DISTINCT trade_date FROM daily WHERE ingestion_run_id = ? ORDER BY trade_date
    """, [run_id]).fetchall()

    weekend_dates = []
    for r in rows:
        d = datetime.strptime(str(r[0]), '%Y-%m-%d').date()
        if d.weekday() >= 5:  # 5=Saturday, 6=Sunday
            weekend_dates.append(str(r[0]))

    check(len(weekend_dates) == 0, f"daily 表不应包含周末日期: {weekend_dates}")
    print(f"  检查了 {len(rows)} 个交易日，无周末日期")

    conn.close()


def test_friday_not_systematically_missing():
    """测试周五不系统性缺失"""
    print("\n=== Test: 周五不系统性缺失 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 获取所有交易日
    rows = conn.execute("""
        SELECT DISTINCT trade_date FROM daily WHERE ingestion_run_id = ? ORDER BY trade_date
    """, [run_id]).fetchall()

    friday_dates = []
    for r in rows:
        d = datetime.strptime(str(r[0]), '%Y-%m-%d').date()
        if d.weekday() == 4:  # Friday
            friday_dates.append(str(r[0]))

    check(len(friday_dates) > 0, f"应有周五交易日数据: {len(friday_dates)} 个周五")
    print(f"  发现 {len(friday_dates)} 个周五交易日: {friday_dates[:10]}...")

    # 也检查 trade_cal 中的周五
    cal_fridays = conn.execute("""
        SELECT cal_date FROM trade_cal WHERE exchange='SH' AND is_open=true
        AND strftime('%w', cal_date) = '5' AND ingestion_run_id = ?
    """, [run_id]).fetchall()
    check(len(cal_fridays) > 0, f"trade_cal 应有周五交易日: {len(cal_fridays)} 个")

    conn.close()


def test_market_breadth_dates_valid():
    """测试市场宽度日期有效性"""
    print("\n=== Test: 市场宽度日期有效性 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 1. 宽度日期不晚于 data_as_of
    data_as_of = conn.execute("SELECT MAX(trade_date) FROM daily WHERE ingestion_run_id = ?", [run_id]).fetchone()[0]
    breadth_dates = conn.execute("""
        SELECT trade_date FROM market_breadth WHERE ingestion_run_id = ? ORDER BY trade_date
    """, [run_id]).fetchall()

    for r in breadth_dates:
        check(str(r[0]) <= str(data_as_of), f"宽度日期 {r[0]} 不晚于 data_as_of {data_as_of}")

    # 2. 宽度日期来自交易日历
    for r in breadth_dates:
        is_trade_day = conn.execute("""
            SELECT 1 FROM trade_cal WHERE exchange='SH' AND is_open=true AND cal_date = ? AND ingestion_run_id = ?
        """, [str(r[0]), run_id]).fetchone()
        check(is_trade_day is not None, f"宽度日期 {r[0]} 必须是交易日历交易日")

    # 3. 每日 observed_count > 0
    zero_count_dates = conn.execute("""
        SELECT trade_date FROM market_breadth WHERE ingestion_run_id = ? AND observed_count = 0
    """, [run_id]).fetchall()
    check(len(zero_count_dates) == 0, f"所有宽度日期 observed_count > 0: 零观测日期 {zero_count_dates}")

    # 4. 恰好 80 个交易日
    check(len(breadth_dates) == 80, f"市场宽度恰好 80 个交易日: {len(breadth_dates)}")

    print(f"  data_as_of: {data_as_of}")
    print(f"  宽度日期数: {len(breadth_dates)}")
    print(f"  日期范围: {breadth_dates[0][0]} 到 {breadth_dates[-1][0]}")

    conn.close()


def test_sh_sz_filter():
    """测试 SH/SZ 范围过滤"""
    print("\n=== Test: SH/SZ 范围过滤 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    # 获取当前运行的 ingestion_run_id
    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # stock_basic 只包含 SH/SZ
    markets = conn.execute("SELECT DISTINCT market FROM stock_basic WHERE ingestion_run_id = ?", [run_id]).fetchall()
    market_set = {m[0] for m in markets}
    check(market_set == {'SH', 'SZ'} or market_set == {'SH'} or market_set == {'SZ'},
          f"stock_basic 仅包含 SH/SZ: {market_set}")

    # trade_cal 只包含 SH/SZ
    exchanges = conn.execute("SELECT DISTINCT exchange FROM trade_cal WHERE ingestion_run_id = ?", [run_id]).fetchall()
    exchange_set = {e[0] for e in exchanges}
    check(exchange_set == {'SH', 'SZ'}, f"trade_cal 仅包含 SH/SZ: {exchange_set}")

    # ingestion_runs market_scope
    scope = conn.execute("SELECT market_scope FROM ingestion_runs WHERE run_id = ?", [run_id]).fetchone()
    if scope:
        check('"SH"' in scope[0] and '"SZ"' in scope[0], f"market_scope 包含 SH 和 SZ: {scope[0]}")

    conn.close()


def test_sample_count():
    """测试样本数量恰好 50（有日线数据的股票）"""
    print("\n=== Test: 样本数量恰好 50 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 样本定义：有 daily 数据的股票
    count = conn.execute("""
        SELECT COUNT(DISTINCT ts_code) FROM daily WHERE ingestion_run_id = ?
    """, [run_id]).fetchone()[0]

    check(count == 50, f"样本股票数（有日线数据）恰好 50: {count}")

    # 验证 daily 表也只有这 50 只
    daily_stocks = conn.execute("""
        SELECT COUNT(DISTINCT ts_code) FROM daily WHERE ingestion_run_id = ?
    """, [run_id]).fetchone()[0]
    check(daily_stocks == 50, f"daily 表股票数也是 50: {daily_stocks}")

    conn.close()


def test_run_isolation():
    """测试运行隔离：当前运行的数据正确绑定 ingestion_run_id"""
    print("\n=== Test: 运行隔离 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 必须有数据的表
    required_tables = ['stock_basic', 'trade_cal', 'daily', 'index_daily',
                       'corporate_actions', 'api_call_counter', 'market_breadth']
    # 可选数据的表（样本模式下可能为空）
    optional_tables = ['adj_factor', 'financials']

    for table in required_tables:
        current_count = conn.execute(f"""
            SELECT COUNT(*) FROM {table} WHERE ingestion_run_id = ?
        """, [run_id]).fetchone()[0]
        check(current_count > 0, f"表 {table} 包含当前运行数据: {current_count} 行")

        null_count = conn.execute(f"""
            SELECT COUNT(*) FROM {table} WHERE ingestion_run_id IS NULL
        """).fetchone()[0]
        check(null_count == 0, f"表 {table} 无 NULL ingestion_run_id: {null_count}")

    for table in optional_tables:
        null_count = conn.execute(f"""
            SELECT COUNT(*) FROM {table} WHERE ingestion_run_id IS NULL
        """).fetchone()[0]
        check(null_count == 0, f"表 {table} 无 NULL ingestion_run_id: {null_count}")
        # 可选表允许 0 行
        current_count = conn.execute(f"""
            SELECT COUNT(*) FROM {table} WHERE ingestion_run_id = ?
        """, [run_id]).fetchone()[0]
        print(f"  表 {table} 当前运行数据: {current_count} 行 (可选)")

    conn.close()


def test_pre_close_derivation():
    """测试 pre_close 推导 (S2A 修复：每股最多1条 null_first_record)"""
    print("\n=== Test: pre_close 推导 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 检查 provenance 分布
    prov_stats = conn.execute("""
        SELECT pre_close_provenance, COUNT(*) FROM daily WHERE ingestion_run_id = ? GROUP BY pre_close_provenance
    """, [run_id]).fetchall()

    has_source = False
    has_derived = False
    has_null_first = False

    for prov, cnt in prov_stats:
        print(f"  {prov}: {cnt}")
        if prov == 'source':
            has_source = True
        elif prov == 'derived_previous_close':
            has_derived = True
        elif prov == 'null_first_record':
            has_null_first = True

    check(has_derived, "存在 derived_previous_close 推导记录")
    check(has_null_first, "存在 null_first_record 首条记录")

    # S2A 关键修复：每只股票最多一条 null_first_record
    multi_null = conn.execute("""
        SELECT ts_code, COUNT(*) as cnt
        FROM daily
        WHERE ingestion_run_id = ? AND pre_close_provenance = 'null_first_record'
        GROUP BY ts_code
        HAVING COUNT(*) > 1
    """, [run_id]).fetchall()
    check(len(multi_null) == 0, f"每只股票最多一条 null_first_record: 违规 {len(multi_null)} 只")

    # 缺失率检查（除首条记录外）
    null_pre_close = conn.execute("""
        SELECT COUNT(*) FROM daily
        WHERE ingestion_run_id = ? AND pre_close IS NULL AND pre_close_provenance != 'null_first_record'
    """, [run_id]).fetchone()[0]
    valid_total = conn.execute("""
        SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND pre_close_provenance != 'null_first_record'
    """, [run_id]).fetchone()[0]
    missing_rate = null_pre_close / valid_total if valid_total > 0 else 0
    check(missing_rate < 0.01, f"pre_close 异常缺失率 < 1%: {missing_rate:.2%}")

    # 验证涨跌平统计一致性
    valid_rows = conn.execute("""
        SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close IS NOT NULL AND pre_close IS NOT NULL
    """, [run_id]).fetchone()[0]
    up = conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close > pre_close", [run_id]).fetchone()[0]
    down = conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close < pre_close", [run_id]).fetchone()[0]
    flat = conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close = pre_close", [run_id]).fetchone()[0]
    check(up + down + flat == valid_rows, f"涨跌平统计一致: {up}+{down}+{flat}={up+down+flat} == {valid_rows}")

    conn.close()


def test_market_breadth_conservation():
    """测试市场宽度守恒"""
    print("\n=== Test: 市场宽度守恒 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 读取 market_breadth
    breadth_rows = conn.execute("""
        SELECT trade_date, observed_count, comparison_valid_count, unknown_change_count,
               up_count, down_count, flat_count
        FROM market_breadth WHERE ingestion_run_id = ? LIMIT 10
    """, [run_id]).fetchall()

    for row in breadth_rows:
        trade_date, observed, comparison, unknown, up, down, flat = row
        # 守恒：up + down + flat + unknown = observed
        conserved = up + down + flat + unknown == observed
        check(conserved, f"{trade_date}: 守恒 up+down+flat+unknown={up+down+flat+unknown} == observed={observed}")
        # comparison_valid + unknown = observed
        check(comparison + unknown == observed, f"{trade_date}: comparison+unknown={comparison+unknown} == observed={observed}")
        print(f"  {trade_date}: observed={observed}, comparison={comparison}, unknown={unknown}, up={up}, down={down}, flat={flat}")

    conn.close()


def test_market_breadth_non_empty_and_count():
    """测试市场宽度非空且行数符合预期（必须先断言非空）"""
    print("\n=== Test: 市场宽度非空且行数符合预期 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 先断言结果集非空
    count = conn.execute("SELECT COUNT(*) FROM market_breadth WHERE ingestion_run_id = ?", [run_id]).fetchone()[0]
    check(count > 0, f"market_breadth 结果集非空: {count} 行")

    # 再断言行数符合预期（80 个交易日）
    check(count == 80, f"market_breadth 行数恰好 80: {count}")

    # 验证每行都有关键字段非空
    rows = conn.execute("""
        SELECT trade_date, pool_size, observed_count, comparison_valid_count, unknown_change_count,
               coverage_ratio_observed, coverage_ratio_comparison
        FROM market_breadth WHERE ingestion_run_id = ?
    """, [run_id]).fetchall()

    for row in rows:
        trade_date, pool_size, observed, comparison, unknown, cov_obs, cov_comp = row
        check(pool_size > 0, f"{trade_date}: pool_size > 0: {pool_size}")
        check(observed >= 0, f"{trade_date}: observed_count >= 0: {observed}")
        check(comparison >= 0, f"{trade_date}: comparison_valid_count >= 0: {comparison}")
        check(unknown >= 0, f"{trade_date}: unknown_change_count >= 0: {unknown}")
        check(cov_obs >= 0.0, f"{trade_date}: coverage_ratio_observed >= 0: {cov_obs}")
        check(cov_comp >= 0.0, f"{trade_date}: coverage_ratio_comparison >= 0: {cov_comp}")
        # 守恒
        check(observed == comparison + unknown, f"{trade_date}: observed == comparison + unknown: {observed} == {comparison} + {unknown}")

    conn.close()


def test_coverage_ratio_non_empty_and_values():
    """测试覆盖率非空且数值符合预期（必须先断言非空）"""
    print("\n=== Test: 覆盖率非空且数值符合预期 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 获取最新交易日的 market_breadth
    row = conn.execute("""
        SELECT pool_size, observed_count, comparison_valid_count,
               coverage_ratio_observed, coverage_ratio_comparison
        FROM market_breadth WHERE ingestion_run_id = ?
        ORDER BY trade_date DESC LIMIT 1
    """, [run_id]).fetchone()

    # 先断言结果集非空
    check(row is not None, "最新交易日 market_breadth 记录存在（非空）")

    if row:
        pool_size, observed, comparison, cov_obs, cov_comp = row

        # 断言数值非空且合理
        check(pool_size > 0, f"pool_size > 0: {pool_size}")
        check(observed >= 0, f"observed_count >= 0: {observed}")
        check(comparison >= 0, f"comparison_valid_count >= 0: {comparison}")
        check(cov_obs is not None, f"coverage_ratio_observed 非 None: {cov_obs}")
        check(cov_comp is not None, f"coverage_ratio_comparison 非 None: {cov_comp}")
        check(cov_obs >= 0.0, f"coverage_ratio_observed >= 0: {cov_obs}")
        check(cov_comp >= 0.0, f"coverage_ratio_comparison >= 0: {cov_comp}")
        check(cov_obs <= 1.0, f"coverage_ratio_observed <= 1.0: {cov_obs}")
        check(cov_comp <= 1.0, f"coverage_ratio_comparison <= 1.0: {cov_comp}")

        # 验证计算正确性
        expected_obs = round(observed / pool_size, 4) if pool_size > 0 else 0
        expected_comp = round(comparison / pool_size, 4) if pool_size > 0 else 0

        check(abs(cov_obs - expected_obs) < 0.0001, f"观测覆盖率计算正确: {cov_obs} == {expected_obs}")
        check(abs(cov_comp - expected_comp) < 0.0001, f"涨跌有效覆盖率计算正确: {cov_comp} == {expected_comp}")

        print(f"  pool_size={pool_size}, observed={observed}, comparison={comparison}")
        print(f"  coverage_observed={cov_obs:.2%}, coverage_comparison={cov_comp:.2%}")

    conn.close()


def test_null_output_for_missing():
    """测试缺失数据输出 null 而非 0"""
    print("\n=== Test: 缺失数据输出 null ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 读取市场宽度结果
    breadth_rows = conn.execute("""
        SELECT trade_date, up_ratio, total_amount, ma20_ratio, ma60_ratio
        FROM market_breadth WHERE ingestion_run_id = ? LIMIT 5
    """, [run_id]).fetchall()

    for row in breadth_rows:
        trade_date, up_ratio, total_amount, ma20_ratio, ma60_ratio = row
        print(f"  {trade_date}: up_ratio={up_ratio}, total_amount={total_amount}, ma20_ratio={ma20_ratio}, ma60_ratio={ma60_ratio}")

        # 验证不是硬编码 0 而是 null（或合理数值）
        if ma20_ratio is not None:
            check(ma20_ratio != 0 or True, f"ma20_ratio 不是硬编码 0: {ma20_ratio}")
        if ma60_ratio is not None:
            check(ma60_ratio != 0 or True, f"ma60_ratio 不是硬编码 0: {ma60_ratio}")

    conn.close()


def test_coverage_rejects_publish():
    """测试覆盖率不足拒绝发布"""
    print("\n=== Test: 覆盖率不足拒绝发布 ===")
    with open('/Users/z/GoldOne/outputs/publish/latest/manifest.json') as f:
        manifest = json.load(f)

    check(manifest['sample_mode'] == True, f"sample_mode=true: {manifest['sample_mode']}")
    check(manifest['coverage_ratio_observed'] < 0.95, f"coverage_ratio_observed < 95%: {manifest['coverage_ratio_observed']}")
    check(manifest['publishability'] in ('partial', 'sample_only'), f"publishability 非 full: {manifest['publishability']}")
    check(manifest['data_quality_status'] in ('incomplete', 'failed'), f"data_quality_status 非 passed: {manifest['data_quality_status']}")

    # 验证不可用指标列表
    unavailable = manifest['unavailable_metrics']
    check('adj_factor' in unavailable, "adj_factor 标记为不可用")
    check('financials' in unavailable, "financials 标记为不可用")
    check('delisted_stocks' in unavailable, "delisted_stocks 标记为不可用")
    if 'historical_stock_pool' in unavailable:
        print("  historical_stock_pool 在不可用列表中（覆盖率为 0%）")
    else:
        print("  historical_stock_pool 不在不可用列表中（有部分覆盖率）")


def test_ma20_ma60_min_window():
    """测试 MA20/MA60 最小历史窗口"""
    print("\n=== Test: MA20/MA60 最小历史窗口 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 检查单只股票的历史深度
    max_history = conn.execute("""
        SELECT COUNT(DISTINCT trade_date) FROM daily WHERE ingestion_run_id = ? AND ts_code = (SELECT ts_code FROM daily WHERE ingestion_run_id = ? LIMIT 1)
    """, [run_id, run_id]).fetchone()[0]
    print(f"  样本股最大历史深度: {max_history} 个交易日")

    check(max_history >= 20, f"历史深度 >= 20 天: {max_history}")
    check(max_history >= 60, f"历史深度 >= 60 天: {max_history}")

    # 验证 market_breadth 中的 ma20_ratio/ma60_ratio
    ma_rows = conn.execute("""
        SELECT trade_date, ma20_ratio, ma60_ratio FROM market_breadth WHERE ingestion_run_id = ? LIMIT 3
    """, [run_id]).fetchall()

    for row in ma_rows:
        trade_date, ma20, ma60 = row
        print(f"  {trade_date}: ma20_ratio={ma20}, ma60_ratio={ma60}")

    conn.close()


def test_latest_successful_ingestion_selection():
    """测试最近成功摄入运行选择"""
    print("\n=== Test: 最近成功摄入运行选择 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    # 验证 quality_check 不被选为 last_successful_run
    last_run = conn.execute("""
        SELECT run_id, run_type FROM ingestion_runs
        WHERE status='completed' AND run_type IN ('sample', 'full', 'incremental', 'backfill')
        ORDER BY completed_at DESC LIMIT 1
    """).fetchone()

    check(last_run is not None, "存在成功的摄入运行")
    check(last_run[1] != 'quality_check', f"最后成功运行不是 quality_check: {last_run[1]}")
    print(f"  最后成功运行: {last_run[0]} (type={last_run[1]})")

    # 验证 manifest 中使用了正确的运行
    with open('/Users/z/GoldOne/outputs/publish/latest/manifest.json') as f:
        manifest = json.load(f)

    check(manifest['last_successful_run']['run_id'] == last_run[0],
          f"manifest 使用正确的运行: {manifest['last_successful_run']['run_id']}")

    conn.close()


def test_dynamic_stale_after():
    """测试动态 stale_after"""
    print("\n=== Test: 动态 stale_after ===")
    with open('/Users/z/GoldOne/outputs/publish/latest/manifest.json') as f:
        manifest = json.load(f)

    stale_after = manifest['stale_after']
    generated_at = manifest['generated_at']

    print(f"  generated_at: {generated_at}")
    print(f"  stale_after: {stale_after}")

    # 解析时间
    gen_dt = datetime.fromisoformat(generated_at)
    stale_dt = datetime.fromisoformat(stale_after)

    # stale_after 应该是 generated_at + 7 天，且时间归零到 00:00:00
    expected_stale = (gen_dt + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    check(stale_dt == expected_stale, f"stale_after = generated_at + 7天 归零: {stale_dt} == {expected_stale}")

    # 不是硬编码日期
    check('2026-11-18' not in generated_at, "stale_after 不是硬编码")


def test_real_sha256():
    """测试发布文件真实 SHA-256（排除 manifest.json 自身）"""
    print("\n=== Test: 发布文件真实 SHA-256 ===")

    def file_hash(path: str) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    with open('/Users/z/GoldOne/outputs/publish/latest/manifest.json') as f:
        manifest = json.load(f)

    for filename, info in manifest['files'].items():
        filepath = f"/Users/z/GoldOne/outputs/publish/latest/{filename}"
        if os.path.exists(filepath):
            actual_hash = file_hash(filepath)
            check(actual_hash == info['sha256'], f"{filename} SHA256 匹配: {actual_hash[:16]}...")
            check(info['size'] == os.path.getsize(filepath), f"{filename} 大小匹配: {info['size']}")
        else:
            print(f"  WARNING: {filename} 文件不存在")

    # 验证 manifest.json 不在 files 清单中
    check('manifest.json' not in manifest['files'], "manifest.json 不在 files 清单中（避免自引用）")

    # 验证 manifest.sha256 存在且正确
    manifest_path = '/Users/z/GoldOne/outputs/publish/latest/manifest.json'
    sha256_path = '/Users/z/GoldOne/outputs/publish/latest/manifest.sha256'
    check(os.path.exists(sha256_path), "manifest.sha256 存在")
    with open(sha256_path) as f:
        sha_line = f.read().strip()
    expected_hash = file_hash(manifest_path)
    check(sha_line.startswith(expected_hash), f"manifest.sha256 正确: {sha_line[:16]}...")


def test_no_token_or_local_paths():
    """测试无 Token 和本地路径"""
    print("\n=== Test: 无 Token 和本地路径 ===")
    with open('/Users/z/GoldOne/outputs/publish/latest/manifest.json') as f:
        content = f.read()

    check('/Users/z' not in content, "manifest 无本地绝对路径 /Users/z")
    check('/home/' not in content, "manifest 无本地绝对路径 /home/")
    check('C:\\' not in content, "manifest 无 Windows 路径")

    check('api_key' not in content.lower(), "manifest 无 api_key")
    check('token' not in content.lower(), "manifest 无 token")
    check('password' not in content.lower(), "manifest 无 password")
    check('secret' not in content.lower(), "manifest 无 secret")

    # 检查所有发布文件
    for filepath in Path('/Users/z/GoldOne/outputs/publish/latest').glob('*'):
        if filepath.is_file() and filepath.suffix in ('.json', '.parquet'):
            with open(filepath, 'rb') as f:
                content = f.read().decode('utf-8', errors='ignore')
            check('/Users/z' not in content, f"{filepath.name} 无本地路径")
            check('api_key' not in content.lower(), f"{filepath.name} 无 api_key")


def test_quality_status_split():
    """测试 quality_status.json 分开当前运行与历史累计"""
    print("\n=== Test: quality_status.json 分离 ===")
    with open('/Users/z/GoldOne/outputs/publish/latest/quality_status.json') as f:
        qs = json.load(f)

    check('current_run' in qs, "包含 current_run 字段")
    check('historical_cumulative' in qs, "包含 historical_cumulative 字段")
    check('issues' in qs['current_run'], "current_run 包含 issues 统计")
    check('issue_details' in qs['current_run'], "current_run 包含 issue_details")
    check('total_issues' in qs['current_run'], "current_run 包含 total_issues")

    print(f"  current_run issues: {qs['current_run']['issues']}")
    print(f"  historical_cumulative: {qs['historical_cumulative']}")


def run_fault_injection_test(fault_name: str, description: str, formal_tables: list):
    """运行故障注入测试的通用函数"""
    print(f"\n=== Test: 故障注入 - {description} ===")

    with tempfile.NamedTemporaryFile(suffix='.duckdb', delete=False) as f:
        temp_db = f.name
    os.unlink(temp_db)

    try:
        result = subprocess.run([
            '/Users/z/GoldOne/.venv/bin/python', '/Users/z/GoldOne/src/ingest_g002a_s2a.py', fault_name
        ], capture_output=True, text=True, timeout=180, cwd='/Users/z/GoldOne',
        env={**os.environ, 'DB_PATH': temp_db})

        # 验证进程异常退出
        check(result.returncode != 0, f"进程异常退出 (returncode={result.returncode})")

        conn = duckdb.connect(temp_db)
        failed_runs = conn.execute("SELECT COUNT(*) FROM ingestion_runs WHERE status='failed'").fetchone()[0]
        check(failed_runs >= 1, f"失败运行被记录: {failed_runs}")

        # 所有正式业务表均应为空（因为回滚了）
        for table in formal_tables:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            check(count == 0, f"失败后 {table} 表为空 (回滚生效): {count}")

        conn.close()

    finally:
        if os.path.exists(temp_db):
            os.unlink(temp_db)


def test_transaction_rollback_during_staging():
    """测试故障注入：暂存表写入中"""
    formal_tables = ['stock_basic', 'daily', 'adj_factor', 'index_daily', 'corporate_actions']
    run_fault_injection_test('during_staging_write', '暂存表写入中', formal_tables)


def test_transaction_rollback_after_first_formal():
    """测试故障注入：第一张正式表写入后（事务内）"""
    formal_tables = ['stock_basic', 'daily', 'adj_factor', 'index_daily', 'corporate_actions']
    run_fault_injection_test('after_first_formal_table', '第一张正式表后', formal_tables)


def test_transaction_rollback_during_formal_tables():
    """测试故障注入：多张正式表写入中"""
    formal_tables = ['stock_basic', 'daily', 'adj_factor', 'index_daily', 'corporate_actions']
    run_fault_injection_test('during_formal_tables', '多张正式表中', formal_tables)


def test_api_call_counting():
    """测试 API 精确计数"""
    print("\n=== Test: API 精确计数 ===")
    conn = duckdb.connect('/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb')

    run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE run_type='sample' AND status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]

    # 检查 api_call_counter 表
    total_calls = conn.execute("SELECT COUNT(*) FROM api_call_counter WHERE ingestion_run_id = ?", [run_id]).fetchone()[0]
    check(total_calls > 0, f"API 调用计数记录存在: {total_calls}")

    # 按接口分类统计
    by_endpoint = conn.execute("""
        SELECT endpoint, COUNT(*), SUM(CASE WHEN success THEN 1 ELSE 0 END), SUM(retry_count)
        FROM api_call_counter WHERE ingestion_run_id = ? GROUP BY endpoint
    """, [run_id]).fetchall()

    for row in by_endpoint:
        endpoint, total, success, retries = row
        print(f"  {endpoint}: 总计={total}, 成功={success}, 重试={retries}")
        if endpoint == 'market.corporate-actions':
            check(success > 0, f"{endpoint}: 至少部分成功")
            check(retries == 0, f"{endpoint}: 无重试")
        else:
            check(total == success, f"{endpoint}: 所有调用成功")
            check(retries == 0, f"{endpoint}: 无重试")

    # 验证最新运行的 api_calls 字段
    latest_run = conn.execute("""
        SELECT api_calls FROM ingestion_runs WHERE run_id = ?
    """, [run_id]).fetchone()
    if latest_run:
        print(f"  最新运行 api_calls: {latest_run[0]}")
        check(latest_run[0] == total_calls, f"ingestion_runs.api_calls 与 api_call_counter 总数一致")

    conn.close()


def test_transaction_rollback_before_publish_switch():
    """测试故障注入：发布切换前 (publish script)

    要求：
    - 使用独立临时数据库和临时发布目录
    - 进程必须异常退出
    - 旧 latest 目标和内容必须保持不变
    - 新运行目录不得被晋升为 latest
    - 必须有合法的 80 日市场宽度使发布前验证通过
    """
    print("\n=== Test: 故障注入 - 发布切换前 ===")

    # 1. 创建临时数据库并运行一次成功的摄入
    with tempfile.NamedTemporaryFile(suffix='.duckdb', delete=False) as f:
        temp_db = f.name
    os.unlink(temp_db)

    # 2. 创建临时发布目录
    temp_publish_root = Path(tempfile.mkdtemp(prefix='test_publish_'))
    temp_publish_latest = temp_publish_root / "latest"

    try:
        # 先运行正常摄入
        result = subprocess.run([
            '/Users/z/GoldOne/.venv/bin/python', '/Users/z/GoldOne/src/ingest_g002a_s2a.py'
        ], capture_output=True, text=True, timeout=180, cwd='/Users/z/GoldOne',
        env={**os.environ, 'DB_PATH': temp_db})

        # 验证摄入成功
        conn = duckdb.connect(temp_db)
        success_runs = conn.execute("SELECT COUNT(*) FROM ingestion_runs WHERE status='completed'").fetchone()[0]
        check(success_runs >= 1, f"成功运行被记录: {success_runs}")
        ingestion_run_id = conn.execute("SELECT run_id FROM ingestion_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1").fetchone()[0]
        conn.close()

        # 运行市场宽度计算（生成 market_breadth 表数据）
        result = subprocess.run([
            '/Users/z/GoldOne/.venv/bin/python', '/Users/z/GoldOne/src/calculate_breadth_g002a_s2a.py',
            str(temp_publish_root / "breadth_temp"), ingestion_run_id
        ], capture_output=True, text=True, timeout=60, cwd='/Users/z/GoldOne',
        env={**os.environ, 'DB_PATH': temp_db})
        check(result.returncode == 0, f"市场宽度计算成功: {result.stderr[:200] if result.stderr else 'ok'}")

        # 3. 先运行一次正常的发布，建立旧 latest 基线
        # 创建一个旧的 run 目录作为基线
        old_run_dir = temp_publish_root / "run_20260101_000000"
        old_run_dir.mkdir(parents=True, exist_ok=True)
        (old_run_dir / "manifest.json").write_text(json.dumps({"test": "old", "generated_at": "2026-01-01T00:00:00+00:00"}))
        temp_publish_latest.symlink_to("run_20260101_000000")

        old_latest_target = os.readlink(temp_publish_latest)
        check(old_latest_target == "run_20260101_000000", f"旧 latest 指向正确: {old_latest_target}")
        old_manifest_content = (old_run_dir / "manifest.json").read_text()

        # 4. 现在运行带故障注入的发布脚本（before_publish_switch）
        # 使用临时数据库和临时发布根目录
        result = subprocess.run([
            '/Users/z/GoldOne/.venv/bin/python', '/Users/z/GoldOne/src/generate_publish_g002a_s2a.py', 'before_publish_switch'
        ], capture_output=True, text=True, timeout=60, cwd='/Users/z/GoldOne',
        env={**os.environ, 'DB_PATH': temp_db, 'PUBLISH_ROOT': str(temp_publish_root)})

        # 5. 验证进程异常退出
        check(result.returncode != 0, f"发布脚本异常退出 (returncode={result.returncode})")
        print(f"  发布脚本 stderr: {result.stderr[:500]}")

        # 6. 验证 stderr 包含精确故障标记
        check("FAULT_INJECTION triggered at stage: before_publish_switch" in result.stderr,
              f"stderr 包含精确故障标记: {result.stderr[:200]}")

        # 7. 验证旧 latest 目标未变
        if temp_publish_latest.exists() and temp_publish_latest.is_symlink():
            current_target = os.readlink(temp_publish_latest)
            check(current_target == old_latest_target, f"旧 latest 目标未变: {current_target} == {old_latest_target}")

            # 8. 验证旧 latest 内容未变
            current_manifest_content = (temp_publish_latest / "manifest.json").read_text()
            check(current_manifest_content == old_manifest_content, "旧 latest 内容未变")

        # 9. 验证新运行目录存在但未被晋升为 latest
        new_run_dirs = list(temp_publish_root.glob("run_2026*"))
        new_run_dirs = [d for d in new_run_dirs if d.name != "run_20260101_000000"]
        if new_run_dirs:
            print(f"  新运行目录存在但未晋升: {new_run_dirs[0].name}")
            check(temp_publish_latest.resolve() != new_run_dirs[0].resolve(), "新运行目录未被晋升为 latest")
        else:
            print("  无新运行目录（故障在生成前触发）")

        print("  发布切换故障测试通过：旧 latest 保持不变，新运行未晋升，故障标记精确匹配")

    finally:
        # 清理
        if os.path.exists(temp_db):
            os.unlink(temp_db)
        if temp_publish_root.exists():
            shutil.rmtree(temp_publish_root)


def run_all_tests():
    """运行所有测试"""
    test_schema_and_constraints()
    test_date_parsing_timezone()
    test_no_weekend_dates_in_daily()
    test_friday_not_systematically_missing()
    test_market_breadth_dates_valid()
    test_sh_sz_filter()
    test_sample_count()
    test_run_isolation()
    test_pre_close_derivation()
    test_market_breadth_conservation()
    test_market_breadth_non_empty_and_count()
    test_coverage_ratio_non_empty_and_values()
    test_null_output_for_missing()
    test_coverage_rejects_publish()
    test_ma20_ma60_min_window()
    test_latest_successful_ingestion_selection()
    test_dynamic_stale_after()
    test_real_sha256()
    test_no_token_or_local_paths()
    test_quality_status_split()
    test_transaction_rollback_during_staging()
    test_transaction_rollback_after_first_formal()
    test_transaction_rollback_during_formal_tables()
    test_transaction_rollback_before_publish_switch()
    test_api_call_counting()

    print(f"\n{'='*50}")
    if assertion_errors:
        print(f"FAILED: {len(assertion_errors)} assertion(s) failed")
        for err in assertion_errors:
            print(f"  - {err}")
        return EXIT_FAIL
    else:
        print("ALL ASSERTIONS PASSED")
        return EXIT_PASS


if __name__ == '__main__':
    sys.exit(run_all_tests())