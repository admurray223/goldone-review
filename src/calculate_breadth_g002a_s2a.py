#!/usr/bin/env python3
"""
GoldOne G002A-S2A 市场宽度计算脚本 - 修复版
修复点：
- 分开输出 observed_count、comparison_valid_count、unknown_change_count
- 强制满足 up+down+flat+unknown = observed
- 样本覆盖率明确区分观测覆盖率和涨跌有效覆盖率
- MA20/MA60/新高新低使用同一运行的相同数据范围
- 所有时间含时区
- 输出到指定目录（不再直接写 latest），由发布脚本统一管理
"""
import duckdb
import json
import sys
import os
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pathlib import Path

DB_PATH = os.environ.get('DB_PATH', "/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb")


def calculate_ma(close_prices: List[float], window: int) -> List[Optional[float]]:
    """计算移动平均线"""
    ma = []
    for i in range(len(close_prices)):
        if i >= window - 1:
            ma.append(sum(close_prices[i-window+1:i+1]) / window)
        else:
            ma.append(None)
    return ma


def calculate_high_low(prices: List[float], window: int, is_high: bool) -> List[Optional[bool]]:
    """计算是否创新高/新低"""
    result = []
    for i in range(len(prices)):
        if i >= window - 1:
            window_prices = prices[i-window+1:i+1]
            if is_high:
                result.append(prices[i] == max(window_prices))
            else:
                result.append(prices[i] == min(window_prices))
        else:
            result.append(None)
    return result


class MarketBreadthCalculator:
    def __init__(self, db_path: str = DB_PATH, ingestion_run_id: str = None):
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self.ingestion_run_id = ingestion_run_id or self._get_latest_ingestion_run()
        print(f"Using ingestion_run_id: {self.ingestion_run_id}")

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

    def get_trade_dates(self, limit: int = 80) -> List[str]:
        """获取最近 N 个交易日"""
        trade_dates = [row[0] for row in self.conn.execute("""
            SELECT cal_date FROM trade_cal
            WHERE exchange = 'SH' AND is_open = true
            ORDER BY cal_date DESC LIMIT ?
        """, [limit]).fetchall()]
        trade_dates.reverse()
        return trade_dates

    def get_historical_stock_pool(self, trade_date: str) -> List[str]:
        """获取指定日期的历史股票池（基于当前运行的 stock_basic）"""
        pool = self.conn.execute("""
            SELECT ts_code FROM stock_basic WHERE market IN ('SH','SZ') AND ingestion_run_id = ?
        """, [self.ingestion_run_id]).fetchall()
        return [row[0] for row in pool]

    def get_daily_data(self, trade_date: str) -> List[Dict]:
        """获取指定日期的日线数据（仅当前运行）"""
        rows = self.conn.execute("""
            SELECT ts_code, open, high, low, close, pre_close, volume, amount
            FROM daily
            WHERE trade_date = ? AND data_source = 'hithink' AND ingestion_run_id = ?
        """, [trade_date, self.ingestion_run_id]).fetchall()

        result = []
        for row in rows:
            result.append({
                'ts_code': row[0],
                'open': row[1],
                'high': row[2],
                'low': row[3],
                'close': row[4],
                'pre_close': row[5],
                'volume': row[6],
                'amount': row[7]
            })
        return result

    def get_stock_history_for_ma(self, ts_code: str, trade_date: str, window: int) -> List[float]:
        """获取股票用于 MA 计算的历史收盘价（仅当前运行）"""
        rows = self.conn.execute("""
            SELECT close FROM daily
            WHERE ts_code = ? AND trade_date <= ? AND data_source = 'hithink'
              AND ingestion_run_id = ? AND close IS NOT NULL
            ORDER BY trade_date
        """, [ts_code, trade_date, self.ingestion_run_id]).fetchall()
        return [row[0] for row in rows]

    def calculate_breadth_for_date(self, trade_date: str) -> Dict[str, Any]:
        """计算单日市场宽度 (S2A 修复版)"""
        # 历史股票池
        pool_codes = set(self.get_historical_stock_pool(trade_date))
        pool_size = len(pool_codes)

        # 当日日线数据
        daily_data = self.get_daily_data(trade_date)

        if not daily_data:
            return {
                'trade_date': trade_date,
                'pool_size': pool_size,
                'observed_count': 0,
                'comparison_valid_count': 0,
                'unknown_change_count': 0,
                'coverage_ratio_observed': 0.0,
                'coverage_ratio_comparison': 0.0,
                'up_count': 0,
                'down_count': 0,
                'flat_count': 0,
                'up_ratio': None,
                'total_amount': None,
                'ma20_count': 0,
                'ma60_count': 0,
                'ma20_ratio': None,
                'ma60_ratio': None,
                'high20_count': 0,
                'low20_count': 0,
                'data_quality_status': 'incomplete',
                'unavailable_metrics': 'no_daily_data'
            }

        # 基础统计
        up = 0
        down = 0
        flat = 0
        total_amount = 0.0
        ma20_count = 0
        ma60_count = 0
        high20_count = 0
        low20_count = 0
        valid_for_ma20 = 0
        valid_for_ma60 = 0
        valid_for_high20 = 0
        valid_for_low20 = 0

        traded_codes = set()
        comparison_valid_codes = set()

        for row in daily_data:
            ts_code = row['ts_code']
            traded_codes.add(ts_code)

            close = row['close']
            pre_close = row['pre_close']
            amount = row['amount']

            if amount:
                total_amount += amount

            # 涨跌平统计（需要 pre_close）
            if close is not None and pre_close is not None:
                comparison_valid_codes.add(ts_code)
                change = close - pre_close
                if change > 0:
                    up += 1
                elif change < 0:
                    down += 1
                else:
                    flat += 1

            # MA20/MA60/新高新低计算
            history = self.get_stock_history_for_ma(ts_code, trade_date, 60)
            if len(history) >= 20:
                valid_for_ma20 += 1
                ma20 = calculate_ma(history, 20)[-1]
                if ma20 is not None and close is not None and close > ma20:
                    ma20_count += 1

            if len(history) >= 60:
                valid_for_ma60 += 1
                ma60 = calculate_ma(history, 60)[-1]
                if ma60 is not None and close is not None and close > ma60:
                    ma60_count += 1

            if len(history) >= 20:
                valid_for_high20 += 1
                high20 = calculate_high_low(history, 20, True)[-1]
                if high20:
                    high20_count += 1

            if len(history) >= 20:
                valid_for_low20 += 1
                low20 = calculate_high_low(history, 20, False)[-1]
                if low20:
                    low20_count += 1

        # S2A 修复：明确分离三个计数
        observed_count = len(traded_codes)
        comparison_valid_count = len(comparison_valid_codes)
        unknown_change_count = observed_count - comparison_valid_count

        # 守恒检查
        assert up + down + flat + unknown_change_count == observed_count, \
            f"守恒失败: up+down+flat+unknown={up+down+flat+unknown_change_count} != observed={observed_count}"

        coverage_ratio_observed = observed_count / pool_size if pool_size > 0 else 0
        coverage_ratio_comparison = comparison_valid_count / pool_size if pool_size > 0 else 0

        # 涨跌比例（基于 comparison_valid_count）
        traded_with_pre_close = up + down + flat
        up_ratio = up / traded_with_pre_close if traded_with_pre_close > 0 else None

        # MA 比例（仅当有足够历史数据的股票才计算）
        ma20_ratio = ma20_count / valid_for_ma20 if valid_for_ma20 > 0 else None
        ma60_ratio = ma60_count / valid_for_ma60 if valid_for_ma60 > 0 else None

        # 确定质量状态
        if coverage_ratio_observed < 0.95:
            quality_status = 'incomplete'
            unavailable = 'coverage_ratio_below_95'
        elif not daily_data:
            quality_status = 'incomplete'
            unavailable = 'no_daily_data'
        else:
            quality_status = 'passed'
            unavailable = None

        return {
            'trade_date': trade_date,
            'pool_size': pool_size,
            'observed_count': observed_count,
            'comparison_valid_count': comparison_valid_count,
            'unknown_change_count': unknown_change_count,
            'coverage_ratio_observed': round(coverage_ratio_observed, 4),
            'coverage_ratio_comparison': round(coverage_ratio_comparison, 4),
            'up_count': up,
            'down_count': down,
            'flat_count': flat,
            'up_ratio': round(up_ratio, 4) if up_ratio is not None else None,
            'total_amount': round(total_amount, 2) if total_amount > 0 else None,
            'ma20_count': ma20_count,
            'ma60_count': ma60_count,
            'ma20_ratio': round(ma20_ratio, 4) if ma20_ratio is not None else None,
            'ma60_ratio': round(ma60_ratio, 4) if ma60_ratio is not None else None,
            'high20_count': high20_count,
            'low20_count': low20_count,
            'data_quality_status': quality_status,
            'unavailable_metrics': unavailable
        }

    def calculate_all(self, limit: int = 80) -> List[Dict]:
        """计算所有交易日的市场宽度"""
        trade_dates = self.get_trade_dates(limit)
        print(f"计算 {len(trade_dates)} 个交易日的市场宽度...")

        results = []
        for trade_date in trade_dates:
            result = self.calculate_breadth_for_date(trade_date)
            results.append(result)
            print(f"  {trade_date}: 池={result['pool_size']}, 观测={result['observed_count']}, "
                  f"可比较={result['comparison_valid_count']}, 未知={result['unknown_change_count']}, "
                  f"观测覆盖率={result['coverage_ratio_observed']:.2%}, "
                  f"涨跌覆盖率={result['coverage_ratio_comparison']:.2%}, "
                  f"涨={result['up_count']}, 跌={result['down_count']}, 平={result['flat_count']}, "
                  f"涨幅={result['up_ratio']:.2%}" if result['up_ratio'] else
                  f"  {trade_date}: 池={result['pool_size']}, 观测={result['observed_count']}, "
                  f"可比较={result['comparison_valid_count']}, 未知={result['unknown_change_count']}, "
                  f"观测覆盖率={result['coverage_ratio_observed']:.2%}, 无涨跌数据")

        return results

    def save_to_db(self, results: List[Dict]):
        """保存市场宽度结果到数据库"""
        for result in results:
            self.conn.execute("""
                INSERT OR REPLACE INTO market_breadth
                (trade_date, pool_size, observed_count, comparison_valid_count, unknown_change_count,
                 coverage_ratio_observed, coverage_ratio_comparison,
                 up_count, down_count, flat_count, up_ratio, total_amount,
                 ma20_count, ma60_count, ma20_ratio, ma60_ratio,
                 high20_count, low20_count, data_quality_status, unavailable_metrics,
                 calculated_at, ingestion_run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                result['trade_date'], result['pool_size'], result['observed_count'],
                result['comparison_valid_count'], result['unknown_change_count'],
                result['coverage_ratio_observed'], result['coverage_ratio_comparison'],
                result['up_count'], result['down_count'], result['flat_count'],
                result['up_ratio'], result['total_amount'],
                result['ma20_count'], result['ma60_count'],
                result['ma20_ratio'], result['ma60_ratio'],
                result['high20_count'], result['low20_count'],
                result['data_quality_status'], result['unavailable_metrics'],
                datetime.now(timezone.utc), self.ingestion_run_id
            ])
        print(f"市场宽度结果已保存到数据库 ({len(results)} 条)")


def main():
    import os
    # 解析命令行参数
    output_dir = None
    ingestion_run_id = None
    if len(sys.argv) > 1:
        output_dir = sys.argv[1]
    if len(sys.argv) > 2:
        ingestion_run_id = sys.argv[2]

    if output_dir:
        Path(output_dir).mkdir(parents=True, exist_ok=True)
    else:
        # 默认输出到临时目录，不写 latest
        output_dir = f"/Users/z/GoldOne/outputs/breadth_temp_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        print(f"WARNING: No output dir specified, using temp: {output_dir}")

    with MarketBreadthCalculator(db_path=DB_PATH, ingestion_run_id=ingestion_run_id) as calc:
        results = calc.calculate_all(80)
        calc.save_to_db(results)

        # 保存 JSON 结果
        def default_serializer(obj):
            if isinstance(obj, (datetime,)):
                return obj.isoformat()
            if hasattr(obj, 'isoformat'):
                return obj.isoformat()
            raise TypeError(f'Object of type {obj.__class__.__name__} is not JSON serializable')

        output = {
            'calculated_at': datetime.now(timezone.utc).isoformat(),
            'period_days': len(results),
            'ingestion_run_id': calc.ingestion_run_id,
            'data_quality_note': f'基于 {results[0]["pool_size"] if results else 0} 只样本股计算，观测覆盖率约 {results[0]["coverage_ratio_observed"]*100:.1f}%，非全市场结果',
            'data': results
        }

        output_file = Path(output_dir) / "breadth_summary.json"
        with open(output_file, "w") as f:
            json.dump(output, f, ensure_ascii=False, indent=2, default=default_serializer)

        print(f"\n市场宽度结果已保存到 {output_file}")


if __name__ == '__main__':
    main()