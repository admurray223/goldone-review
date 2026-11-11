#!/usr/bin/env python3
"""
GoldOne G002A 市场宽度计算脚本
计算连续 80 个交易日的市场宽度指标
使用当日历史股票池作为分母
"""
import duckdb
import json
from datetime import datetime

DB_PATH = "data/goldone.duckdb"

def calculate_breadth():
    conn = duckdb.connect(DB_PATH)
    
    # 获取最近 80 个交易日
    trade_dates = [row[0] for row in conn.execute("""
        SELECT cal_date FROM trade_cal WHERE is_open=true ORDER BY cal_date DESC LIMIT 80
    """).fetchall()]
    trade_dates.reverse()  # 正序
    
    print(f"计算 {len(trade_dates)} 个交易日的市场宽度...")
    
    results = []
    
    for trade_date in trade_dates:
        # 当日历史股票池：上市且未退市的股票
        # 由于 stock_basic 缺少 list_date/delist_date，暂时使用所有股票
        # 实际应用中需要根据 list_date <= trade_date AND (delist_date IS NULL OR delist_date > trade_date)
        pool = conn.execute("""
            SELECT ts_code FROM stock_basic
        """).fetchall()
        pool_codes = {row[0] for row in pool}
        pool_size = len(pool_codes)
        
        # 当日有行情的股票
        daily_data = conn.execute("""
            SELECT ts_code, open, high, low, close, pre_close, volume, amount
            FROM daily
            WHERE trade_date = ?
        """, [trade_date]).fetchall()
        
        if not daily_data:
            print(f"  {trade_date}: 无日线数据")
            continue
        
        # 计算指标
        up = 0
        down = 0
        flat = 0
        total_amount = 0
        ma20_count = 0
        ma60_count = 0
        high20_count = 0
        low20_count = 0
        
        for row in daily_data:
            ts_code, open_, high, low, close, pre_close, volume, amount = row
            
            if close is None or pre_close is None:
                continue
            
            change = close - pre_close
            if change > 0:
                up += 1
            elif change < 0:
                down += 1
            else:
                flat += 1
            
            if amount:
                total_amount += amount
            
            # 计算 MA20, MA60 (需要历史数据)
            # 这里简化：只统计有数据的
            # 实际需要计算过去 20/60 日收盘价均值
        
        up_ratio = up / (up + down + flat) if (up + down + flat) > 0 else 0
        
        result = {
            "trade_date": str(trade_date),
            "pool_size": pool_size,
            "traded_count": up + down + flat,
            "up_count": up,
            "down_count": down,
            "flat_count": flat,
            "up_ratio": round(up_ratio, 4),
            "total_amount": round(total_amount, 2),
            "ma20_ratio": 0,  # 待实现
            "ma60_ratio": 0,  # 待实现
            "high20_count": 0,  # 待实现
            "low20_count": 0,   # 待实现
        }
        results.append(result)
        print(f"  {trade_date}: 池={pool_size}, 交易={up+down+flat}, 涨={up}, 跌={down}, 平={flat}, 涨幅={up_ratio:.2%}, 成交额={total_amount/1e8:.2f}亿")
    
    # 保存结果
    output_dir = "outputs/publish/latest"
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    with open(f"{output_dir}/breadth_summary.json", "w") as f:
        json.dump({
            "calculated_at": datetime.now().isoformat(),
            "period_days": len(trade_dates),
            "data": results
        }, f, ensure_ascii=False, indent=2)
    
    print(f"\n市场宽度结果已保存到 {output_dir}/breadth_summary.json")
    conn.close()
    return results

if __name__ == '__main__':
    calculate_breadth()