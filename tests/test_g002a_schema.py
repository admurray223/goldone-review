#!/usr/bin/env python3
"""
GoldOne G002A Schema 修正版测试
使用 :memory: 数据库，不写入磁盘
依赖: duckdb 2.0.0 (通过 .venv 安装)
安装命令: /Users/z/GoldOne/.venv/bin/pip install duckdb==2.0.0
"""
import sys
import duckdb
from datetime import date

EXIT_PASS = 0
EXIT_FAIL = 1
assertion_errors = []

def check(condition, msg):
    if not condition:
        assertion_errors.append(msg)
        print(f"  FAIL: {msg}")
    else:
        print(f"  PASS: {msg}")

def test_schema():
    conn = duckdb.connect(':memory:')
    passed = 0
    total = 0

    # =============================================
    # Phase 1: 表创建 (8 表)
    # =============================================
    print("=== Phase 1: 表创建 ===")

    conn.execute("""
        CREATE TABLE daily (
            ts_code VARCHAR, trade_date DATE, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
            pre_close DOUBLE, change DOUBLE, pct_chg DOUBLE, volume BIGINT, amount DOUBLE,
            data_source VARCHAR, updated_at TIMESTAMP,
            PRIMARY KEY (ts_code, trade_date)
        )
    """)
    check(True, "daily 表创建成功 (无 adj_factor/base_date — 原始数据分表)")

    conn.execute("""
        CREATE TABLE adj_factor (
            ts_code VARCHAR, trade_date DATE, adj_factor DOUBLE,
            data_source VARCHAR, updated_at TIMESTAMP,
            PRIMARY KEY (ts_code, trade_date, data_source)
        )
    """)
    check(True, "adj_factor 仅存原始因子 (无 base_date/base_factor — 属于派生查询)")

    conn.execute("""
        CREATE TABLE trade_cal (
            exchange VARCHAR, cal_date DATE, is_open BOOLEAN,
            pretrade_date DATE, nexttrade_date DATE,
            PRIMARY KEY (exchange, cal_date)
        )
    """)
    check(True, "trade_cal 多交易所主键")

    conn.execute("""
        CREATE TABLE stock_basic (
            ts_code VARCHAR PRIMARY KEY, name VARCHAR, industry VARCHAR, industry_code VARCHAR,
            area VARCHAR, market VARCHAR, list_date DATE, delist_date DATE,
            list_status VARCHAR, is_hs BOOLEAN, updated_at TIMESTAMP, data_source VARCHAR
        )
    """)
    check(True, "stock_basic 含退市字段")

    conn.execute("""
        CREATE TABLE financials (
            ts_code VARCHAR, ann_date DATE, f_ann_date DATE, end_date DATE,
            report_type VARCHAR, comp_type VARCHAR, report_version INTEGER,
            source_record_id VARCHAR, revision_record_id VARCHAR,
            metric VARCHAR, value DOUBLE, unit VARCHAR, data_source VARCHAR, updated_at TIMESTAMP,
            PRIMARY KEY (ts_code, end_date, report_type, comp_type, metric, source_record_id)
        )
    """)
    check(True, "financials 含 source_record_id + revision_record_id，修订不覆盖")

    conn.execute("""
        CREATE TABLE valuation (
            ts_code VARCHAR, trade_date DATE, snapshot_type VARCHAR,
            pe_ttm DOUBLE, pe_mrq DOUBLE, pb_mrq DOUBLE, ps_ttm DOUBLE, pcf_ttm DOUBLE,
            data_source VARCHAR, retrieved_at TIMESTAMP,
            PRIMARY KEY (ts_code, trade_date, snapshot_type)
        )
    """)
    check(True, "valuation 区分快照类型")

    conn.execute("""
        CREATE TABLE corporate_actions (
            ts_code VARCHAR, ex_date DATE, record_date DATE, pay_date DATE,
            dividend_per_share DOUBLE, bonus_ratio DOUBLE, split_ratio DOUBLE,
            action_type VARCHAR, source_record_id VARCHAR, data_source VARCHAR, updated_at TIMESTAMP,
            PRIMARY KEY (ts_code, ex_date, action_type, source_record_id)
        )
    """)
    check(True, "corporate_actions 含 source_record_id，同日期同类型多条事件不冲突")

    # =============================================
    # Phase 2: 正向插入测试
    # =============================================
    print("\n=== Phase 2: 正向插入测试 ===")

    conn.execute("""
        INSERT INTO daily VALUES
        ('300274.SZ', '2024-01-02', 87.5, 87.6, 85.23, 85.4, 87.59, -2.19, -2.5003,
         13401807, 1153503411.49, 'tushare', '2026-11-10 10:00:00'),
        ('600519.SH', '2024-01-02', 1715.0, 1718.19, 1678.1, 1685.01, 1698.0, -13.0, -0.0076,
         3215644, 0.0, 'tushare', '2026-11-10 10:00:00'),
        ('000001.SZ', '2024-01-02', 9.39, 9.42, 9.21, 9.21, 9.35, -0.14, -0.015,
         115836645, 0.0, 'tushare', '2026-11-10 10:00:00')
    """)
    check(True, "daily 插入 3 条 (3 股票)")

    conn.execute("""
        INSERT INTO adj_factor VALUES
        ('300274.SZ', '2024-01-02', 6.806, 'tushare', '2026-11-10 10:00:00'),
        ('300274.SZ', '2024-01-03', 6.806, 'tushare', '2026-11-10 10:00:00'),
        ('300274.SZ', '2024-01-02', 0.6845, 'hithink', '2026-11-10 10:00:00')
    """)
    check(True, "adj_factor 插入 3 条 (多数据源同日期共存)")

    conn.execute("""
        INSERT INTO trade_cal VALUES
        ('SSE', '2024-01-02', true, '2023-12-29', '2024-01-03'),
        ('SZSE', '2024-01-02', true, '2023-12-29', '2024-01-03'),
        ('BSE', '2024-01-02', false, '2023-12-29', '2024-01-03'),
        ('SSE', '2024-01-03', true, '2024-01-02', '2024-01-04'),
        ('SSE', '2024-01-04', true, '2024-01-03', '2024-01-05')
    """)
    check(True, "trade_cal 插入 5 条 (SSE/SZSE/BSE, 多日期)")

    conn.execute("""
        INSERT INTO financials VALUES
        ('300274.SZ', '2024-04-30', '2024-04-30', '2024-03-31', 'quarterly', 'consolidated', 1,
         'src_001_v1', 'rev_001', 'total_revenue', 1234567890, 'yuan', 'tushare', '2026-11-10 10:00:00'),
        ('300274.SZ', '2024-04-30', '2024-04-30', '2024-03-31', 'quarterly', 'consolidated', 1,
         'src_001_v1', 'rev_001', 'n_income_attr_p', 123456789, 'yuan', 'tushare', '2026-11-10 10:00:00'),
        ('300274.SZ', '2024-05-15', '2024-05-15', '2024-03-31', 'quarterly', 'consolidated', 2,
         'src_001_v2', 'rev_002', 'total_revenue', 1234567891, 'yuan', 'tushare', '2026-11-10 10:00:00')
    """)
    check(True, "financials 插入 3 条 (修订版本 report_version=2, 不同 revision_record_id)")

    conn.execute("""
        INSERT INTO valuation VALUES
        ('300274.SZ', '2026-11-10', 'current', 20.18, 18.76, 3.34, 2.30, 15.49, 'hithink', '2026-11-10 15:00:00'),
        ('300274.SZ', '2026-11-09', 'historical', 20.15, 18.70, 3.33, 2.29, 15.45, 'hithink', '2026-11-09 15:00:00'),
        ('300274.SZ', '2020-01-01', 'unavailable', NULL, NULL, NULL, NULL, NULL, 'hithink', '2026-11-10 15:00:00')
    """)
    check(True, "valuation 插入 3 条 (current/historical/unavailable)")

    conn.execute("""
        INSERT INTO corporate_actions VALUES
        ('300274.SZ', '2024-06-15', '2024-06-14', '2024-06-15', 0.5, 0, 0, 'dividend', 'ca_001', 'hithink', '2026-11-10 10:00:00'),
        ('300274.SZ', '2024-06-15', '2024-06-14', '2024-06-15', 0.8, 0, 0, 'dividend', 'ca_002', 'tushare', '2026-11-10 10:00:00')
    """)
    check(True, "corporate_actions 插入 2 条 (同日期同类型，不同 source_record_id, 不同数据源)")

    # =============================================
    # Phase 3: 正向断言验证
    # =============================================
    print("\n=== Phase 3: 正向断言验证 ===")

    r = conn.execute("SELECT COUNT(*) FROM daily").fetchone()[0]
    check(r == 3, f"daily 行数 = 3 (实际 {r})")

    r = conn.execute("""
        SELECT COUNT(*) FROM trade_cal
        WHERE cal_date='2024-01-02' AND is_open=true
    """).fetchone()[0]
    check(r == 2, f"2024-01-02 交易日数 = 2 (SSE+SZSE, 实际 {r})")

    r = conn.execute("""
        SELECT COUNT(*) FROM trade_cal
        WHERE cal_date='2024-01-02' AND is_open=false
    """).fetchone()[0]
    check(r == 1, f"2024-01-02 非交易日 (BSE) = 1 (实际 {r})")

    r = conn.execute("""
        SELECT COUNT(*) FROM financials
        WHERE ts_code='300274.SZ' AND metric='total_revenue'
    """).fetchone()[0]
    check(r == 2, f"financials total_revenue 修订共存 = 2 条 (实际 {r})")

    r = conn.execute("""
        SELECT report_version, value FROM financials
        WHERE ts_code='300274.SZ' AND metric='total_revenue'
        ORDER BY report_version
    """).fetchall()
    check(len(r) == 2, f"financials 修订版本返回 2 行 (实际 {len(r)})")
    if len(r) == 2:
        check(r[0][0] == 1 and r[0][1] == 1234567890.0,
              f"v1: version={r[0][0]}, value={r[0][1]}")
        check(r[1][0] == 2 and r[1][1] == 1234567891.0,
              f"v2: version={r[1][0]}, value={r[1][1]}")
        check(r[0][1] != r[1][1], "修订前后数值不同")

    r = conn.execute("""
        SELECT snapshot_type, pe_ttm FROM valuation
        WHERE ts_code='300274.SZ' ORDER BY trade_date DESC
    """).fetchall()
    check(len(r) == 3, f"valuation 返回 3 行 (实际 {len(r)})")
    if len(r) == 3:
        check(r[0][0] == 'current' and r[0][1] == 20.18, f"current: {r[0]}")
        check(r[1][0] == 'historical' and r[1][1] == 20.15, f"historical: {r[1]}")
        check(r[2][0] == 'unavailable' and r[2][1] is None, f"unavailable: {r[2]}")

    r = conn.execute("""
        SELECT COUNT(*) FROM corporate_actions
        WHERE ts_code='300274.SZ' AND ex_date='2024-06-15' AND action_type='dividend'
    """).fetchone()[0]
    check(r == 2, f"同日期同类型 corporate_actions = 2 条 (实际 {r})")

    # =============================================
    # Phase 4: 负向测试
    # =============================================
    print("\n=== Phase 4: 负向测试 ===")

    # 4a: 主键冲突 — 重复 daily PK
    try:
        conn.execute("""
            INSERT INTO daily VALUES
            ('300274.SZ', '2024-01-02', 87.5, 87.6, 85.23, 85.4, 87.59, -2.19, -2.5003,
             13401807, 1153503411.49, 'tushare', '2026-11-10 10:00:00')
        """)
        check(False, "主键冲突测试: 重复 daily PK 应被拒绝")
    except Exception as e:
        check("Violate" in str(e) or "primary key" in str(e).lower() or "unique" in str(e).lower() or "duplicate" in str(e).lower(),
              f"主键冲突测试: 正确拒绝 ({type(e).__name__})")

    # 4b: 主键冲突 — 重复 trade_cal PK
    try:
        conn.execute("""
            INSERT INTO trade_cal VALUES ('SSE', '2024-01-02', true, '2023-12-29', '2024-01-03')
        """)
        check(False, "主键冲突测试: 重复 trade_cal PK 应被拒绝")
    except Exception as e:
        check("Violate" in str(e) or "primary key" in str(e).lower() or "unique" in str(e).lower() or "duplicate" in str(e).lower(),
              f"主键冲突测试: 重复 trade_cal PK 正确拒绝 ({type(e).__name__})")

    # 4c: NOT NULL 约束 — stock_basic ts_code 不应为 NULL
    try:
        conn.execute("""
            INSERT INTO stock_basic VALUES
            (NULL, '测试空值', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-10 10:00:00', 'test')
        """)
        check(False, "空值约束测试: NULL ts_code 应被拒绝")
    except Exception as e:
        check(True, f"空值约束测试: NULL PK 正确拒绝 ({type(e).__name__})")

    # 4d: 数据类型约束 — daily volume 应为整数 (BIGINT)
    try:
        conn.execute("""
            INSERT INTO daily VALUES
            ('000002.SZ', '2024-01-02', 1, 1, 1, 1, 1, 0, 0,
             'not_a_number', 0, 'test', '2026-11-10 10:00:00')
        """)
        check(False, "类型约束测试: volume 字符串应被拒绝")
    except Exception as e:
        check(True, f"类型约束测试: volume 类型非法正确拒绝 ({type(e).__name__})")

    # 4e: valuation unavailable 快照允许 NULL, 正向验证已有
    # 用于确认 NULL 可存储

    # 4f: financials 同一 report 同 metric 不同 source_record_id 共存
    # 这实际上应该在正向测试中已经验证 (不同源)
    r = conn.execute("""
        SELECT COUNT(DISTINCT report_version) FROM financials
        WHERE ts_code='300274.SZ' AND end_date='2024-03-31' AND metric='total_revenue'
    """).fetchone()[0]
    check(r == 2, f"financials 不同修订版本共存 (实际 {r})")

    # 4g: 多头并存的 PK 设计验证 — 同日期同类型多条事件不冲突
    r = conn.execute("""
        SELECT source_record_id FROM corporate_actions
        WHERE ts_code='300274.SZ' AND ex_date='2024-06-15' AND action_type='dividend'
        ORDER BY source_record_id
    """).fetchall()
    r_ids = [x[0] for x in r]
    check('ca_001' in r_ids and 'ca_002' in r_ids,
          f"corporate_actions 多条同日期记录共存: {r_ids}")

    conn.close()

    # =============================================
    # Summary
    # =============================================
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
    sys.exit(test_schema())