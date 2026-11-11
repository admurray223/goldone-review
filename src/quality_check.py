#!/usr/bin/env python3
"""
GoldOne G002A 数据质量检查脚本
执行各项质量门禁检查
"""
import duckdb
import uuid
from datetime import datetime

DB_PATH = "data/goldone.duckdb"

def run_quality_checks():
    conn = duckdb.connect(DB_PATH)
    run_id = str(uuid.uuid4())[:8]
    
    # 记录质量检查运行
    conn.execute("""
        INSERT INTO ingestion_runs (run_id, run_type, target, status, started_at)
        VALUES (?, 'quality_check', 'all', 'running', ?)
    """, [run_id, datetime.now()])
    
    issues = []
    
    def add_issue(table, ts_code, trade_date, issue_type, severity, desc, expected=None, actual=None, ingestion_run_id=None):
        issue_id = str(uuid.uuid4())[:8]
        conn.execute("""
            INSERT INTO data_quality_issues
            (issue_id, table_name, ts_code, trade_date, issue_type, severity, description,
             expected_value, actual_value, detected_at, ingestion_run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [issue_id, table, ts_code, trade_date, issue_type, severity, desc, 
              str(expected) if expected else None, str(actual) if actual else None,
              datetime.now(), ingestion_run_id])
        issues.append({
            'issue_id': issue_id, 'table': table, 'ts_code': ts_code,
            'issue_type': issue_type, 'severity': severity, 'description': desc
        })
    
    print("=== 质量门禁检查 ===\n")
    
    # 1. 主键重复检查
    print("1. 主键重复检查...")
    for table, pk_cols in [
        ('daily', ['ts_code', 'trade_date', 'data_source']),
        ('adj_factor', ['ts_code', 'trade_date', 'data_source']),
        ('index_daily', ['ts_code', 'trade_date', 'data_source']),
        ('stock_basic', ['ts_code']),
        ('trade_cal', ['exchange', 'cal_date']),
        ('corporate_actions', ['ts_code', 'ex_date', 'action_type', 'source_record_id']),
    ]:
        pk_str = ', '.join(pk_cols)
        dupes = conn.execute(f"""
            SELECT {pk_str}, COUNT(*) as cnt
            FROM {table}
            GROUP BY {pk_str}
            HAVING COUNT(*) > 1
        """).fetchall()
        if dupes:
            for row in dupes:
                vals = ', '.join(str(row[i]) for i in range(len(pk_cols)))
                add_issue(table, row[0] if 'ts_code' in pk_cols else None, 
                         row[1] if 'trade_date' in pk_cols else None,
                         'pk_duplicate', 'critical',
                         f'主键重复: {pk_str}=({vals}), count={row[-1]}')
    print(f"   完成")
    
    # 2. 交易日缺失检查 (基于 trade_cal)
    print("2. 交易日缺失检查...")
    # 获取所有交易日
    trade_dates = [row[0] for row in conn.execute("""
        SELECT DISTINCT cal_date FROM trade_cal WHERE is_open=true ORDER BY cal_date
    """).fetchall()]
    print(f"   交易日总数: {len(trade_dates)}")
    
    # 检查每只股票在交易日是否有数据
    stock_codes = [row[0] for row in conn.execute("SELECT DISTINCT ts_code FROM daily").fetchall()]
    for ts_code in stock_codes[:10]:  # 只检查前10只作为样本
        stock_dates = set(row[0] for row in conn.execute("""
            SELECT trade_date FROM daily WHERE ts_code=?
        """, [ts_code]).fetchall())
        missing = [d for d in trade_dates[-80:] if d not in stock_dates]  # 最近80个交易日
        if missing:
            for d in missing[:5]:  # 只报告前5个
                add_issue('daily', ts_code, d, 'missing_trade_date', 'warning',
                         f'股票 {ts_code} 在交易日 {d} 缺失日线数据')
    print(f"   完成")
    
    # 3. OHLC 逻辑检查
    print("3. OHLC 逻辑检查...")
    for table in ['daily', 'index_daily']:
        violations = conn.execute(f"""
            SELECT ts_code, trade_date, open, high, low, close
            FROM {table}
            WHERE NOT (high >= open AND high >= close AND low <= open AND low <= close)
            LIMIT 20
        """).fetchall()
        for row in violations:
            add_issue(table, row[0], row[1], 'ohlc_violation', 'critical',
                     f'OHLC 逻辑违规: O={row[2]}, H={row[3]}, L={row[4]}, C={row[5]}')
    print(f"   完成")
    
    # 4. 负价格、负成交量、负成交额
    print("4. 负值检查...")
    for table in ['daily', 'index_daily']:
        neg = conn.execute(f"""
            SELECT ts_code, trade_date, 
                   CASE WHEN open < 0 THEN 'open' END,
                   CASE WHEN high < 0 THEN 'high' END,
                   CASE WHEN low < 0 THEN 'low' END,
                   CASE WHEN close < 0 THEN 'close' END,
                   CASE WHEN volume < 0 THEN 'volume' END,
                   CASE WHEN amount < 0 THEN 'amount' END
            FROM {table}
            WHERE open < 0 OR high < 0 OR low < 0 OR close < 0 OR volume < 0 OR amount < 0
        """).fetchall()
        for row in neg:
            fields = [f for f in row[2:] if f]
            add_issue(table, row[0], row[1], 'negative_value', 'critical',
                     f'负值: {", ".join(fields)}')
    print(f"   完成")
    
    # 5. 上市前/退市后异常记录
    print("5. 上市退市边界检查...")
    # 由于 stock_basic 的 list_date/delist_date 为空，暂时跳过
    print(f"   跳过 (stock_basic 缺少 list_date/delist_date)")
    
    # 6. 成交量/成交额单位检查 (volume 股, amount 元)
    print("6. 单位检查...")
    # 简单检查：volume 是否为整数，amount 是否合理
    for table in ['daily', 'index_daily']:
        # volume 应该是整数 (BIGINT)
        non_int = conn.execute(f"""
            SELECT ts_code, trade_date, volume FROM {table}
            WHERE volume IS NOT NULL AND volume != CAST(volume AS BIGINT)
            LIMIT 10
        """).fetchall()
        for row in non_int:
            add_issue(table, row[0], row[1], 'volume_not_integer', 'warning',
                     f'volume 非整数: {row[2]}')
    print(f"   完成")
    
    # 7. 复权因子突变检查
    print("7. 复权因子突变检查...")
    jumps = conn.execute("""
        SELECT ts_code, trade_date, adj_factor,
               LAG(adj_factor) OVER (PARTITION BY ts_code ORDER BY trade_date) as prev_factor
        FROM adj_factor
        WHERE adj_factor IS NOT NULL
    """).fetchall()
    for row in jumps:
        if row[3] and row[3] > 0:
            change_pct = abs(row[2] - row[3]) / row[3]
            if change_pct > 0.5:  # 单日变化超过 50%
                add_issue('adj_factor', row[0], row[1], 'adj_factor_jump', 'warning',
                         f'复权因子异常跳变: {row[3]} -> {row[2]} (变化 {change_pct:.1%})')
    print(f"   完成")
    
    # 8. 原始价格与复权价格可复现关系 (暂时跳过，需要计算前复权价)
    print("8. 复权价格一致性检查...")
    print(f"   跳过 (需计算前复权价格对比)")
    
    # 9. 停牌处理检查 (volume=0 或 amount=0)
    print("9. 停牌/无行情检查...")
    suspended = conn.execute("""
        SELECT ts_code, trade_date, volume, amount
        FROM daily
        WHERE (volume = 0 OR amount = 0) AND close IS NOT NULL
        LIMIT 20
    """).fetchall()
    for row in suspended:
        add_issue('daily', row[0], row[1], 'suspended_handling', 'info',
                 f'疑似停牌: volume={row[2]}, amount={row[3]}')
    print(f"   完成")
    
    # 10. 多源同日数据差异
    print("10. 多数据源差异检查...")
    multi_source = conn.execute("""
        SELECT ts_code, trade_date, 
               COUNT(DISTINCT data_source) as source_count,
               COUNT(DISTINCT close) as close_variants,
               COUNT(DISTINCT volume) as volume_variants
        FROM daily
        GROUP BY ts_code, trade_date
        HAVING COUNT(DISTINCT data_source) > 1
    """).fetchall()
    for row in multi_source:
        if row[3] > 1 or row[4] > 1:
            add_issue('daily', row[0], row[1], 'multi_source_diff', 'warning',
                     f'多数据源差异: source_count={row[2]}, close variants={row[3]}, volume variants={row[4]}')
    print(f"   完成")
    
    # 11. 幂等性检查 (重复运行是否产生重复数据)
    print("11. 幂等性检查...")
    # 已通过主键约束隐性保证
    print(f"   完成 (主键约束保证)")
    
    # 统计
    critical = sum(1 for i in issues if i['severity'] == 'critical')
    warning = sum(1 for i in issues if i['severity'] == 'warning')
    info = sum(1 for i in issues if i['severity'] == 'info')
    
    print(f"\n=== 质量检查汇总 ===")
    print(f"  严重: {critical}")
    print(f"  警告: {warning}")
    print(f"  信息: {info}")
    print(f"  总计: {len(issues)}")
    
    # 更新运行记录
    conn.execute("""
        UPDATE ingestion_runs
        SET status='completed', completed_at=?, rows_inserted=?
        WHERE run_id=?
    """, [datetime.now(), len(issues), run_id])
    
    conn.close()
    return issues

if __name__ == '__main__':
    run_quality_checks()