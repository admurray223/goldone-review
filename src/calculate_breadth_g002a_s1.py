#!/usr/bin/env python3
"""
GoldOne G002A-S1 市场宽度计算脚本 - 完整版
支持：
- 基于历史股票池计算（上市且未退市）
- 覆盖率计算与门禁
- MA20/MA60/新高新低窗口计算
- 缺失数据输出 null 而非 0
- 质量状态标记
"""
import duckdb
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = "/Users/z/GoldOne/data/goldone_g002a_s1.duckdb"
OUTPUT_DIR = "/Users/z/GoldOne/outputs/publish/latest"

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
        """获取指定日期的历史股票池（已上市、未退市、SH/SZ）"""
        # 由于 stock_basic 缺少 list_date/delist_date，使用所有 SH/SZ 股票
        # 实际应用中应按 list_date <= trade_date AND (delist_date IS NULL OR delist_date > trade_date) 筛选
        pool = self.conn.execute("""
            SELECT ts_code FROM stock_basic WHERE market IN ('SH','SZ')
        """).fetchall()
        return [row[0] for row in pool]

    def get_daily_data(self, trade_date: str) -> List[Dict]:
        """获取指定日期的日线数据"""
        rows = self.conn.execute("""
            SELECT ts_code, open, high, low, close, pre_close, volume, amount
            FROM daily
            WHERE trade_date = ? AND data_source = 'hithink'
        """, [trade_date]).fetchall()

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
        """获取股票用于 MA 计算的历史收盘价"""
        rows = self.conn.execute("""
            SELECT close FROM daily
            WHERE ts_code = ? AND trade_date <= ? AND data_source = 'hithink' AND close IS NOT NULL
            ORDER BY trade_date
        """, [ts_code, trade_date]).fetchall()
        return [row[0] for row in rows]

    def calculate_breadth_for_date(self, trade_date: str) -> Dict[str, Any]:
        """计算单日市场宽度"""
        # 历史股票池
        pool_codes = set(self.get_historical_stock_pool(trade_date))
        pool_size = len(pool_codes)

        # 当日日线数据
        daily_data = self.get_daily_data(trade_date)

        if not daily_data:
            return {
                'trade_date': trade_date,
                'pool_size': pool_size,
                'traded_count': 0,
                'suspended_or_missing_count': pool_size,
                'coverage_ratio': 0.0,
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

        traded_count = len(traded_codes)
        suspended_or_missing = pool_size - traded_count
        coverage_ratio = traded_count / pool_size if pool_size > 0 else 0

        # 涨跌比例
        traded_with_pre_close = up + down + flat
        up_ratio = up / traded_with_pre_close if traded_with_pre_close > 0 else None

        # MA 比例（仅当有足够历史数据的股票才计算）
        ma20_ratio = ma20_count / valid_for_ma20 if valid_for_ma20 > 0 else None
        ma60_ratio = ma60_count / valid_for_ma60 if valid_for_ma60 > 0 else None

        # 确定质量状态
        if coverage_ratio < 0.95:
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
            'traded_count': traded_count,
            'suspended_or_missing_count': suspended_or_missing,
            'coverage_ratio': round(coverage_ratio, 4),
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
            print(f"  {trade_date}: 池={result['pool_size']}, 交易={result['traded_count']}, "
                  f"覆盖率={result['coverage_ratio']:.2%}, 涨={result['up_count']}, "
                  f"跌={result['down_count']}, 平={result['flat_count']}, "
                  f"涨幅={result['up_ratio']:.2%}" if result['up_ratio'] else
                  f"  {trade_date}: 池={result['pool_size']}, 交易={result['traded_count']}, "
                  f"覆盖率={result['coverage_ratio']:.2%}, 无涨跌数据")

        return results

    def save_to_db(self, results: List[Dict]):
        """保存市场宽度结果到数据库"""
        for result in results:
            self.conn.execute("""
                INSERT OR REPLACE INTO market_breadth
                (trade_date, pool_size, traded_count, suspended_or_missing_count, coverage_ratio,
                 up_count, down_count, flat_count, up_ratio, total_amount,
                 ma20_count, ma60_count, ma20_ratio, ma60_ratio,
                 high20_count, low20_count, data_quality_status, unavailable_metrics,
                 calculated_at, ingestion_run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                result['trade_date'], result['pool_size'], result['traded_count'],
                result['suspended_or_missing_count'], result['coverage_ratio'],
                result['up_count'], result['down_count'], result['flat_count'],
                result['up_ratio'], result['total_amount'],
                result['ma20_count'], result['ma60_count'],
                result['ma20_ratio'], result['ma60_ratio'],
                result['high20_count'], result['low20_count'],
                result['data_quality_status'], result['unavailable_metrics'],
                datetime.now(), self.ingestion_run_id
            ])
        print(f"市场宽度结果已保存到数据库 ({len(results)} 条)")

def main():
    import os
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with MarketBreadthCalculator() as calc:
        results = calc.calculate_all(80)
        calc.save_to_db(results)

        # 保存 JSON 结果
        def default_serializer(obj):
            if isinstance(obj, (datetime,)):
                return obj.isoformat()
            if hasattr(obj, 'isoformat'):  # date objects
                return obj.isoformat()
            raise TypeError(f'Object of type {obj.__class__.__name__} is not JSON serializable')

        output = {
            'calculated_at': datetime.now().isoformat(),
            'period_days': len(results),
            'data_quality_note': '基于 50 只样本股计算，覆盖率约 3.8%，非全市场结果',
            'data': results
        }

        with open(f"{OUTPUT_DIR}/breadth_summary.json", "w") as f:
            json.dump(output, f, ensure_ascii=False, indent=2, default=default_serializer)

        print(f"\n市场宽度结果已保存到 {OUTPUT_DIR}/breadth_summary.json")

if __name__ == '__main__':
    main()