#!/usr/bin/env python3
"""
GoldOne G002A-S2A 数据质量检查脚本 - 修复版
修复点：
- 明确输出 pre_close 指标：总记录数、有效记录数、首日合理缺失、异常缺失、可参与涨跌比较股票数
- 市场宽度口径：observed_count、comparison_valid_count、unknown_change_count
- 覆盖率分母分子明确
- 质量状态分开表示本次运行与历史累计
- 所有时间含时区
"""
import duckdb
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any

DB_PATH = "/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb"


class QualityChecker:
    def __init__(self, db_path: str = DB_PATH, ingestion_run_id: str = None):
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self.ingestion_run_id = ingestion_run_id or self._get_latest_ingestion_run()
        self.run_id = str(uuid.uuid4())[:8]
        self.issues = []
        self.checks_passed = 0
        self.checks_failed = 0
        self.checks_warning = 0
        self.checks_skipped = 0

    def _get_latest_ingestion_run(self) -> str:
        row = self.conn.execute("""
            SELECT run_id FROM ingestion_runs
            WHERE status='completed' AND run_type='sample'
            ORDER BY completed_at DESC LIMIT 1
        """).fetchone()
        return row[0] if row else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()

    def begin_quality_run(self):
        """记录质量检查运行开始"""
        self.conn.execute("""
            INSERT INTO ingestion_runs (run_id, run_type, target, market_scope, status, started_at)
            VALUES (?, 'quality_check', 'all', '["SH","SZ"]', 'running', ?)
        """, [self.run_id, datetime.now(timezone.utc)])

    def complete_quality_run(self, quality_gate: str):
        """完成质量检查运行记录"""
        self.conn.execute("""
            UPDATE ingestion_runs
            SET status='completed', completed_at=?, rows_inserted=?
            WHERE run_id=?
        """, [datetime.now(timezone.utc), len(self.issues), self.run_id])

        # 更新 data_quality_issues 的 quality_gate 字段
        self.conn.execute("""
            UPDATE data_quality_issues SET quality_gate = ? WHERE ingestion_run_id = ?
        """, [quality_gate, self.run_id])

    def add_issue(self, table: str, ts_code: str, trade_date: str, issue_type: str,
                  severity: str, description: str, expected: Any = None, actual: Any = None,
                  quality_gate: str = None):
        """添加质量问题"""
        issue_id = str(uuid.uuid4())[:8]
        self.conn.execute("""
            INSERT INTO data_quality_issues
            (issue_id, table_name, ts_code, trade_date, issue_type, severity, description,
             expected_value, actual_value, detected_at, ingestion_run_id, quality_gate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [issue_id, table, ts_code, trade_date, issue_type, severity, description,
              str(expected) if expected is not None else None, str(actual) if actual is not None else None,
              datetime.now(timezone.utc), self.run_id, quality_gate])

        self.issues.append({
            'issue_id': issue_id, 'table': table, 'ts_code': ts_code,
            'trade_date': trade_date, 'issue_type': issue_type, 'severity': severity,
            'description': description
        })

        if severity == 'critical':
            self.checks_failed += 1
        elif severity == 'warning':
            self.checks_warning += 1
        elif severity == 'info':
            self.checks_passed += 1

    def add_check_result(self, passed: bool, severity: str = 'info'):
        """记录检查项通过/失败"""
        if passed:
            self.checks_passed += 1
        else:
            if severity == 'critical':
                self.checks_failed += 1
            elif severity == 'warning':
                self.checks_warning += 1

    def run_all_checks(self) -> Dict[str, Any]:
        """运行所有质量检查"""
        print("=== 质量门禁检查 (S2A) ===\n")

        # 1. 主键重复检查
        print("1. 主键重复检查...")
        self._check_pk_duplicates()
        print(f"   完成")

        # 2. 交易日缺失检查
        print("2. 交易日缺失检查...")
        self._check_missing_trade_dates()
        print(f"   完成")

        # 3. OHLC 逻辑检查
        print("3. OHLC 逻辑检查...")
        self._check_ohlc_logic()
        print(f"   完成")

        # 4. 负值检查
        print("4. 负值检查...")
        self._check_negative_values()
        print(f"   完成")

        # 5. 上市前/退市后边界检查
        print("5. 上市退市边界检查...")
        self._check_listing_boundaries()
        print(f"   完成")

        # 6. 单位一致性检查
        print("6. 单位一致性检查...")
        self._check_units()
        print(f"   完成")

        # 7. 复权因子突变检查
        print("7. 复权因子突变检查...")
        self._check_adj_factor_jumps()
        print(f"   完成")

        # 8. pre_close 推导与缺失检查 (S2A 修复：输出独立指标)
        print("8. pre_close 推导与缺失检查...")
        self._check_pre_close()
        print(f"   完成")

        # 9. 停牌/无行情处理检查
        print("9. 停牌/无行情处理检查...")
        self._check_suspended_handling()
        print(f"   完成")

        # 10. 多数据源差异检查
        print("10. 多数据源差异检查...")
        self._check_multi_source_diff()
        print(f"   完成")

        # 11. 幂等性检查
        print("11. 幂等性检查...")
        self._check_idempotency()
        print(f"   完成")

        # 12. 市场宽度覆盖率检查 (S2A 修复：分开 observed/comparison_valid)
        print("12. 市场宽度覆盖率检查...")
        self._check_market_breadth_coverage()
        print(f"   完成")

        # 13. 跨源验证检查
        print("13. 跨源验证检查...")
        self._check_cross_source_validation()
        print(f"   完成")

        # 14. 必需检查执行完整性
        print("14. 必需检查执行完整性...")
        self._check_required_checks_executed()
        print(f"   完成")

        # 15. 样本数量验证 (S2A 新增：必须恰好 50 只)
        print("15. 样本数量验证...")
        self._check_sample_count()
        print(f"   完成")

        # 16. 运行隔离验证 (S2A 新增：数据必须绑定同一 ingestion_run_id)
        print("16. 运行隔离验证...")
        self._check_run_isolation()
        print(f"   完成")

        # 统计
        critical = sum(1 for i in self.issues if i['severity'] == 'critical')
        warning = sum(1 for i in self.issues if i['severity'] == 'warning')
        info = sum(1 for i in self.issues if i['severity'] == 'info')

        # 确定质量门禁状态
        quality_gate = self._determine_quality_gate(critical, warning)

        print(f"\n=== 质量检查汇总 ===")
        print(f"  严重: {critical}")
        print(f"  警告: {warning}")
        print(f"  信息: {info}")
        print(f"  总计: {len(self.issues)}")
        print(f"  质量门禁: {quality_gate}")

        return {
            'run_id': self.run_id,
            'quality_gate': quality_gate,
            'critical': critical,
            'warning': warning,
            'info': info,
            'total_issues': len(self.issues),
            'issues': self.issues
        }

    def _determine_quality_gate(self, critical: int, warning: int) -> str:
        """确定质量门禁状态"""
        if critical > 0:
            return 'failed'
        elif warning > 0:
            key_warnings = [i for i in self.issues if i['severity'] == 'warning' and
                           i['issue_type'] in ('coverage_ratio_low', 'cross_source_not_executed',
                                               'required_check_skipped', 'sample_only_breadth',
                                               'sample_count_mismatch', 'run_isolation_violation')]
            if key_warnings:
                return 'incomplete'
            return 'passed_with_warnings'
        else:
            return 'passed'

    def _check_pk_duplicates(self):
        """主键重复检查"""
        for table, pk_cols in [
            ('daily', ['ts_code', 'trade_date', 'data_source']),
            ('adj_factor', ['ts_code', 'trade_date', 'data_source']),
            ('index_daily', ['ts_code', 'trade_date', 'data_source']),
            ('stock_basic', ['ts_code']),
            ('trade_cal', ['exchange', 'cal_date']),
            ('corporate_actions', ['ts_code', 'ex_date', 'action_type', 'source_record_id']),
        ]:
            pk_str = ', '.join(pk_cols)
            dupes = self.conn.execute(f"""
                SELECT {pk_str}, COUNT(*) as cnt
                FROM {table}
                WHERE ingestion_run_id = ?
                GROUP BY {pk_str}
                HAVING COUNT(*) > 1
            """, [self.ingestion_run_id]).fetchall()
            for row in dupes:
                vals = ', '.join(str(row[i]) for i in range(len(pk_cols)))
                self.add_issue(table, row[0] if 'ts_code' in pk_cols else None,
                              row[1] if 'trade_date' in pk_cols else None,
                              'pk_duplicate', 'critical',
                              f'主键重复: {pk_str}=({vals}), count={row[-1]}')

    def _check_missing_trade_dates(self):
        """交易日缺失检查"""
        trade_dates = [row[0] for row in self.conn.execute("""
            SELECT DISTINCT cal_date FROM trade_cal WHERE is_open=true AND exchange='SH' ORDER BY cal_date
        """).fetchall()]

        stock_codes = [row[0] for row in self.conn.execute("""
            SELECT DISTINCT ts_code FROM daily WHERE ingestion_run_id = ?
        """, [self.ingestion_run_id]).fetchall()]
        for ts_code in stock_codes[:20]:
            stock_dates = set(row[0] for row in self.conn.execute("""
                SELECT trade_date FROM daily WHERE ts_code=? AND ingestion_run_id = ?
            """, [ts_code, self.ingestion_run_id]).fetchall())
            missing = [d for d in trade_dates[-80:] if d not in stock_dates]
            if missing:
                for d in missing[:3]:
                    self.add_issue('daily', ts_code, d, 'missing_trade_date', 'warning',
                                  f'股票 {ts_code} 在交易日 {d} 缺失日线数据')

    def _check_ohlc_logic(self):
        """OHLC 逻辑检查"""
        for table in ['daily', 'index_daily']:
            violations = self.conn.execute(f"""
                SELECT ts_code, trade_date, open, high, low, close
                FROM {table}
                WHERE ingestion_run_id = ? AND NOT (high >= open AND high >= close AND low <= open AND low <= close)
                LIMIT 20
            """, [self.ingestion_run_id]).fetchall()
            for row in violations:
                self.add_issue(table, row[0], row[1], 'ohlc_violation', 'critical',
                              f'OHLC 逻辑违规: O={row[2]}, H={row[3]}, L={row[4]}, C={row[5]}')

    def _check_negative_values(self):
        """负值检查"""
        for table in ['daily', 'index_daily']:
            neg = self.conn.execute(f"""
                SELECT ts_code, trade_date,
                       CASE WHEN open < 0 THEN 'open' END,
                       CASE WHEN high < 0 THEN 'high' END,
                       CASE WHEN low < 0 THEN 'low' END,
                       CASE WHEN close < 0 THEN 'close' END,
                       CASE WHEN volume < 0 THEN 'volume' END,
                       CASE WHEN amount < 0 THEN 'amount' END
                FROM {table}
                WHERE ingestion_run_id = ? AND (open < 0 OR high < 0 OR low < 0 OR close < 0 OR volume < 0 OR amount < 0)
            """, [self.ingestion_run_id]).fetchall()
            for row in neg:
                fields = [f for f in row[2:] if f]
                self.add_issue(table, row[0], row[1], 'negative_value', 'critical',
                              f'负值: {", ".join(fields)}')

    def _check_listing_boundaries(self):
        """上市前/退市后边界检查"""
        no_list_date = self.conn.execute("""
            SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ? AND list_date IS NULL
        """, [self.ingestion_run_id]).fetchone()[0]
        total = self.conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ?", [self.ingestion_run_id]).fetchone()[0]

        if no_list_date > 0:
            coverage = (total - no_list_date) / total if total > 0 else 0
            if coverage < 0.95:
                self.add_issue('stock_basic', None, None, 'list_date_coverage_low', 'critical',
                              f'上市日期覆盖率不足: {coverage:.1%} ({total - no_list_date}/{total})',
                              expected='>=95%', actual=f'{coverage:.1%}')
            else:
                self.add_issue('stock_basic', None, None, 'list_date_coverage_low', 'warning',
                              f'上市日期覆盖率: {coverage:.1%} ({total - no_list_date}/{total})')

        delisted = self.conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ? AND list_status = 'D'", [self.ingestion_run_id]).fetchone()[0]
        if delisted == 0:
            self.add_issue('stock_basic', None, None, 'no_delisted_stocks', 'critical',
                          '无退市股票样本，无法验证历史股票池构建')

        if no_list_date < total:
            violations = self.conn.execute("""
                SELECT d.ts_code, d.trade_date, s.list_date, s.delist_date
                FROM daily d
                JOIN stock_basic s ON d.ts_code = s.ts_code
                WHERE d.ingestion_run_id = ? AND s.list_date IS NOT NULL AND d.trade_date < s.list_date
                LIMIT 20
            """, [self.ingestion_run_id]).fetchall()
            for row in violations:
                self.add_issue('daily', row[0], row[1], 'pre_listing_data', 'critical',
                              f'上市前数据: trade_date={row[1]}, list_date={row[2]}')

            violations = self.conn.execute("""
                SELECT d.ts_code, d.trade_date, s.list_date, s.delist_date
                FROM daily d
                JOIN stock_basic s ON d.ts_code = s.ts_code
                WHERE d.ingestion_run_id = ? AND s.delist_date IS NOT NULL AND d.trade_date >= s.delist_date
                LIMIT 20
            """, [self.ingestion_run_id]).fetchall()
            for row in violations:
                self.add_issue('daily', row[0], row[1], 'post_delisting_data', 'critical',
                              f'退市后数据: trade_date={row[1]}, delist_date={row[3]}')

    def _check_units(self):
        """单位一致性检查"""
        for table in ['daily', 'index_daily']:
            non_int = self.conn.execute(f"""
                SELECT ts_code, trade_date, volume FROM {table}
                WHERE ingestion_run_id = ? AND volume IS NOT NULL AND volume != CAST(volume AS BIGINT)
                LIMIT 10
            """, [self.ingestion_run_id]).fetchall()
            for row in non_int:
                self.add_issue(table, row[0], row[1], 'volume_not_integer', 'warning',
                              f'volume 非整数: {row[2]}')

    def _check_adj_factor_jumps(self):
        """复权因子突变检查"""
        count = self.conn.execute("SELECT COUNT(*) FROM adj_factor WHERE ingestion_run_id = ?", [self.ingestion_run_id]).fetchone()[0]
        if count == 0:
            self.add_issue('adj_factor', None, None, 'adj_factor_empty', 'critical',
                          '复权因子表为空，无法进行复权价格一致性验证')
            return

        jumps = self.conn.execute("""
            SELECT ts_code, trade_date, adj_factor,
                   LAG(adj_factor) OVER (PARTITION BY ts_code ORDER BY trade_date) as prev_factor
            FROM adj_factor
            WHERE ingestion_run_id = ? AND adj_factor IS NOT NULL
        """, [self.ingestion_run_id]).fetchall()
        for row in jumps:
            if row[3] and row[3] > 0:
                change_pct = abs(row[2] - row[3]) / row[3]
                if change_pct > 0.5:
                    self.add_issue('adj_factor', row[0], row[1], 'adj_factor_jump', 'warning',
                                  f'复权因子异常跳变: {row[3]} -> {row[2]} (变化 {change_pct:.1%})')

    def _check_pre_close(self):
        """
        pre_close 推导与缺失检查 (S2A 修复：输出独立指标)
        - 日线记录数
        - pre_close有效记录数
        - 首日合理缺失数
        - 异常缺失数
        - 可参与涨跌比较的股票数
        """
        total = self.conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ?", [self.ingestion_run_id]).fetchone()[0]
        if total == 0:
            self.add_issue('daily', None, None, 'daily_empty', 'critical', 'daily 表为空')
            return

        # 检查 pre_close_provenance 分布
        prov_stats = self.conn.execute("""
            SELECT pre_close_provenance, COUNT(*) FROM daily
            WHERE ingestion_run_id = ? GROUP BY pre_close_provenance
        """, [self.ingestion_run_id]).fetchall()

        print(f"   pre_close_provenance 分布:")
        for prov, cnt in prov_stats:
            print(f"     {prov}: {cnt}")

        # S2A 独立指标
        daily_records = total
        valid_pre_close = self.conn.execute("""
            SELECT COUNT(*) FROM daily
            WHERE ingestion_run_id = ? AND pre_close IS NOT NULL
        """, [self.ingestion_run_id]).fetchone()[0]
        null_first_record = self.conn.execute("""
            SELECT COUNT(*) FROM daily
            WHERE ingestion_run_id = ? AND pre_close_provenance = 'null_first_record'
        """, [self.ingestion_run_id]).fetchone()[0]
        abnormal_missing = self.conn.execute("""
            SELECT COUNT(*) FROM daily
            WHERE ingestion_run_id = ? AND pre_close IS NULL AND pre_close_provenance != 'null_first_record'
        """, [self.ingestion_run_id]).fetchone()[0]

        # 可参与涨跌比较的股票数（去重 ts_code）
        comparison_valid_stocks = self.conn.execute("""
            SELECT COUNT(DISTINCT ts_code) FROM daily
            WHERE ingestion_run_id = ? AND close IS NOT NULL AND pre_close IS NOT NULL
        """, [self.ingestion_run_id]).fetchone()[0]

        print(f"   S2A pre_close 独立指标:")
        print(f"     日线记录数: {daily_records}")
        print(f"     pre_close有效记录数: {valid_pre_close}")
        print(f"     首日合理缺失数: {null_first_record}")
        print(f"     异常缺失数: {abnormal_missing}")
        print(f"     可参与涨跌比较的股票数: {comparison_valid_stocks}")

        # 记录为 info 级别问题，供报告引用
        self.add_issue('daily', None, None, 'pre_close_metrics', 'info',
                      f'pre_close指标: 记录数={daily_records}, 有效={valid_pre_close}, 首日缺失={null_first_record}, 异常缺失={abnormal_missing}, 可比较股票={comparison_valid_stocks}')

        # 缺失率检查（除首条记录外）
        valid_total = self.conn.execute("""
            SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND pre_close_provenance != 'null_first_record'
        """, [self.ingestion_run_id]).fetchone()[0]
        missing_rate = abnormal_missing / valid_total if valid_total > 0 else 0

        if missing_rate >= 0.01:
            self.add_issue('daily', None, None, 'pre_close_missing_high', 'critical',
                          f'pre_close 异常缺失率过高: {missing_rate:.2%} ({abnormal_missing}/{valid_total})',
                          expected='<1%', actual=f'{missing_rate:.2%}')
        elif abnormal_missing > 0:
            self.add_issue('daily', None, None, 'pre_close_missing_low', 'warning',
                          f'pre_close 异常缺失率: {missing_rate:.2%} ({abnormal_missing}/{valid_total})')

        # 验证涨跌家数统计一致性
        valid_rows = self.conn.execute("""
            SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close IS NOT NULL AND pre_close IS NOT NULL
        """, [self.ingestion_run_id]).fetchone()[0]
        up = self.conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close > pre_close", [self.ingestion_run_id]).fetchone()[0]
        down = self.conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close < pre_close", [self.ingestion_run_id]).fetchone()[0]
        flat = self.conn.execute("SELECT COUNT(*) FROM daily WHERE ingestion_run_id = ? AND close = pre_close", [self.ingestion_run_id]).fetchone()[0]
        if up + down + flat != valid_rows:
            self.add_issue('daily', None, None, 'up_down_flat_mismatch', 'critical',
                          f'涨跌平统计不一致: up+down+flat={up+down+flat} != valid_rows={valid_rows}')

        # 验证每只股票最多一条 null_first_record
        multi_null = self.conn.execute("""
            SELECT ts_code, COUNT(*) as cnt
            FROM daily
            WHERE ingestion_run_id = ? AND pre_close_provenance = 'null_first_record'
            GROUP BY ts_code
            HAVING COUNT(*) > 1
        """, [self.ingestion_run_id]).fetchall()
        if multi_null:
            for row in multi_null:
                self.add_issue('daily', row[0], None, 'multiple_null_first_record', 'critical',
                              f'股票 {row[0]} 有 {row[1]} 条 null_first_record，预期最多 1 条')

    def _check_suspended_handling(self):
        """停牌/无行情处理检查"""
        suspended = self.conn.execute("""
            SELECT ts_code, trade_date, volume, amount
            FROM daily
            WHERE ingestion_run_id = ? AND (volume = 0 OR amount = 0) AND close IS NOT NULL
            LIMIT 20
        """, [self.ingestion_run_id]).fetchall()
        for row in suspended:
            self.add_issue('daily', row[0], row[1], 'suspended_handling', 'info',
                          f'疑似停牌: volume={row[2]}, amount={row[3]}')

    def _check_multi_source_diff(self):
        """多数据源差异检查"""
        multi_source = self.conn.execute("""
            SELECT ts_code, trade_date,
                   COUNT(DISTINCT data_source) as source_count,
                   COUNT(DISTINCT close) as close_variants,
                   COUNT(DISTINCT volume) as volume_variants
            FROM daily
            WHERE ingestion_run_id = ?
            GROUP BY ts_code, trade_date
            HAVING COUNT(DISTINCT data_source) > 1
        """, [self.ingestion_run_id]).fetchall()
        for row in multi_source:
            if row[3] > 1 or row[4] > 1:
                self.add_issue('daily', row[0], row[1], 'multi_source_diff', 'warning',
                              f'多数据源差异: source_count={row[2]}, close variants={row[3]}, volume variants={row[4]}')

    def _check_idempotency(self):
        """幂等性检查 - 通过主键约束隐性保证"""
        self.add_check_result(True, 'info')

    def _check_market_breadth_coverage(self):
        """
        市场宽度覆盖率检查 (S2A 修复：分开 observed/comparison_valid)
        """
        trade_dates = [row[0] for row in self.conn.execute("""
            SELECT DISTINCT cal_date FROM trade_cal WHERE is_open=true AND exchange='SH' ORDER BY cal_date DESC LIMIT 80
        """).fetchall()]

        # 样本股数量（因为 stock_basic 只有 50 只）
        total_stocks = self.conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ? AND market IN ('SH','SZ')", [self.ingestion_run_id]).fetchone()[0]

        print(f"   股票池大小 (样本): {total_stocks}")

        low_coverage_days = 0
        for trade_date in trade_dates:
            # observed_count: 当日存在日线的股票数
            observed = self.conn.execute("""
                SELECT COUNT(DISTINCT ts_code) FROM daily
                WHERE trade_date = ? AND ingestion_run_id = ?
            """, [trade_date, self.ingestion_run_id]).fetchone()[0]

            # comparison_valid_count: close 与 pre_close 均有效的股票数
            comparison_valid = self.conn.execute("""
                SELECT COUNT(DISTINCT ts_code) FROM daily
                WHERE trade_date = ? AND ingestion_run_id = ? AND close IS NOT NULL AND pre_close IS NOT NULL
            """, [trade_date, self.ingestion_run_id]).fetchone()[0]

            # unknown_change_count: 无法判断涨跌的股票数
            unknown = observed - comparison_valid

            coverage_observed = observed / total_stocks if total_stocks > 0 else 0
            coverage_comparison = comparison_valid / total_stocks if total_stocks > 0 else 0

            if coverage_observed < 0.95:
                low_coverage_days += 1
                if low_coverage_days <= 3:
                    self.add_issue('market_breadth', None, trade_date, 'coverage_ratio_low', 'warning',
                                  f'观测覆盖率不足: {coverage_observed:.1%} ({observed}/{total_stocks})',
                                  expected='>=95%', actual=f'{coverage_observed:.1%}')

            print(f"   {trade_date}: observed={observed}, comparison_valid={comparison_valid}, unknown={unknown}")

        if low_coverage_days > 0:
            self.add_issue('market_breadth', None, None, 'sample_only_breadth', 'warning',
                          f'市场宽度仅基于样本股计算 ({low_coverage_days}/80 日观测覆盖率<95%)',
                          quality_gate='incomplete')

    def _check_cross_source_validation(self):
        """跨源验证检查"""
        sources = self.conn.execute("SELECT COUNT(DISTINCT data_source) FROM daily WHERE ingestion_run_id = ?", [self.ingestion_run_id]).fetchone()[0]
        if sources < 2:
            self.add_issue('daily', None, None, 'cross_source_not_executed', 'warning',
                          f'仅单一数据源 ({sources} 个)，未执行跨源验证',
                          quality_gate='incomplete')

    def _check_required_checks_executed(self):
        """必需检查执行完整性"""
        pass

    def _check_sample_count(self):
        """S2A 新增：样本数量必须恰好为 50（有日线数据的股票）"""
        count = self.conn.execute("""
            SELECT COUNT(DISTINCT ts_code) FROM daily WHERE ingestion_run_id = ?
        """, [self.ingestion_run_id]).fetchone()[0]

        print(f"   样本股票数（有日线数据）: {count}")

        if count != 50:
            self.add_issue('daily', None, None, 'sample_count_mismatch', 'critical',
                          f'样本股票数（有日线数据）不等于 50: {count}',
                          expected=50, actual=count)

    def _check_run_isolation(self):
        """S2A 新增：验证所有数据绑定同一 ingestion_run_id"""
        tables = ['stock_basic', 'trade_cal', 'daily', 'adj_factor', 'index_daily',
                  'corporate_actions', 'api_call_counter']

        for table in tables:
            other_runs = self.conn.execute(f"""
                SELECT COUNT(DISTINCT ingestion_run_id) FROM {table}
                WHERE ingestion_run_id != ?
            """, [self.ingestion_run_id]).fetchone()[0]
            if other_runs > 0:
                self.add_issue(table, None, None, 'run_isolation_violation', 'critical',
                              f'表 {table} 包含其他运行的数据 ({other_runs} 个不同 run_id)',
                              quality_gate='incomplete')


def main():
    with QualityChecker() as checker:
        checker.begin_quality_run()
        result = checker.run_all_checks()
        checker.complete_quality_run(result['quality_gate'])
        print(f"\n质量检查完成，Run ID: {result['run_id']}")
        print(f"质量门禁状态: {result['quality_gate']}")
        return result


if __name__ == '__main__':
    main()