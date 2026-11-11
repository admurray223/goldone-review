#!/usr/bin/env python3
"""
GoldOne G002A 生成发布包
创建云端只读展示所需的发布文件
"""
import duckdb
import json
import hashlib
from datetime import datetime
from pathlib import Path

DB_PATH = "data/goldone.duckdb"
OUTPUT_DIR = Path("outputs/publish/latest")

def file_hash(path):
    """计算文件 SHA256"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(DB_PATH)
    
    # 获取最新成功运行
    last_run = conn.execute("""
        SELECT run_id, completed_at, api_calls, rows_inserted, data_as_of
        FROM ingestion_runs
        WHERE status='completed'
        ORDER BY completed_at DESC
        LIMIT 1
    """).fetchone()
    
    # 获取质量检查运行
    quality_run = conn.execute("""
        SELECT run_id, completed_at, rows_inserted as issue_count
        FROM ingestion_runs
        WHERE run_type='quality_check' AND status='completed'
        ORDER BY completed_at DESC
        LIMIT 1
    """).fetchone()
    
    # 统计表行数
    table_counts = {}
    for table in ['ingestion_runs', 'stock_basic', 'trade_cal', 'daily', 'adj_factor', 
                  'index_daily', 'financials', 'corporate_actions', 'data_quality_issues']:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        table_counts[table] = count
    
    # 质量问题统计
    quality_stats = conn.execute("""
        SELECT severity, COUNT(*) FROM data_quality_issues GROUP BY severity
    """).fetchall()
    quality_dict = {row[0]: row[1] for row in quality_stats}
    
    # 市场摘要 (最新交易日)
    latest_date = conn.execute("SELECT MAX(trade_date) FROM daily").fetchone()[0]
    if latest_date:
        market_summary = conn.execute("""
            SELECT 
                COUNT(*) as traded_count,
                SUM(CASE WHEN close > pre_close THEN 1 ELSE 0 END) as up_count,
                SUM(CASE WHEN close < pre_close THEN 1 ELSE 0 END) as down_count,
                SUM(CASE WHEN close = pre_close THEN 1 ELSE 0 END) as flat_count,
                SUM(amount) as total_amount
            FROM daily
            WHERE trade_date = ?
        """, [latest_date]).fetchone()
        market_summary_dict = {
            "trade_date": str(latest_date),
            "traded_count": market_summary[0] or 0,
            "up_count": market_summary[1] or 0,
            "down_count": market_summary[2] or 0,
            "flat_count": market_summary[3] or 0,
            "total_amount": round(market_summary[4] or 0, 2)
        }
    else:
        market_summary_dict = {}
    
    # 指数状态
    index_status = []
    for row in conn.execute("""
        SELECT ts_code, MAX(trade_date) as latest_date, 
               COUNT(*) as data_points
        FROM index_daily
        GROUP BY ts_code
    """).fetchall():
        index_status.append({
            "ts_code": row[0],
            "latest_date": str(row[1]),
            "data_points": row[2]
        })
    
    # 生成 manifest.json
    manifest = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now().isoformat(),
        "data_as_of": str(latest_date) if latest_date else None,
        "last_successful_run": {
            "run_id": last_run[0] if last_run else None,
            "completed_at": last_run[1].isoformat() if last_run else None,
            "api_calls": last_run[2] if last_run else 0,
            "rows_inserted": last_run[3] if last_run else 0,
            "data_as_of": str(last_run[4]) if last_run and last_run[4] else None
        } if last_run else None,
        "quality_gate": {
            "run_id": quality_run[0] if quality_run else None,
            "completed_at": quality_run[1].isoformat() if quality_run else None,
            "issues": {
                "critical": quality_dict.get("critical", 0),
                "warning": quality_dict.get("warning", 0),
                "info": quality_dict.get("info", 0),
                "total": sum(quality_dict.values())
            }
        } if quality_run else None,
        "stale_after": "2026-11-18T00:00:00Z",  # 7天后过期
        "source_summary": {
            "tables": table_counts,
            "data_sources": ["hithink"],
            "date_range": {
                "daily": {"start": "2026-05-18", "end": "2026-11-10"},
                "index_daily": {"start": "2026-05-18", "end": "2026-11-10"},
                "trade_cal": {"start": "2025-11-11", "end": "2026-11-11"}
            }
        },
        "files": {}
    }
    
    # 导出必要的 Parquet 文件 (只读展示用)
    # 1. 市场摘要
    with open(OUTPUT_DIR / "market_summary.json", "w") as f:
        json.dump(market_summary_dict, f, ensure_ascii=False, indent=2)
    
    # 2. 指数状态
    with open(OUTPUT_DIR / "index_status.json", "w") as f:
        json.dump({"indices": index_status, "updated_at": datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)
    
    # 3. 读取已有的 breadth_summary.json
    breadth_path = OUTPUT_DIR / "breadth_summary.json"
    if breadth_path.exists():
        with open(breadth_path) as f:
            breadth_data = json.load(f)
    else:
        breadth_data = {}
    
    # 4. 质量状态
    quality_status = {
        "checked_at": quality_run[1].isoformat() if quality_run else datetime.now().isoformat(),
        "issues": quality_dict,
        "total_issues": sum(quality_dict.values())
    }
    with open(OUTPUT_DIR / "quality_status.json", "w") as f:
        json.dump(quality_status, f, ensure_ascii=False, indent=2)
    
    # 5. 导出样本数据为 Parquet (仅导出最近 80 个交易日的 10 只样本股)
    sample_stocks = ["600519.SH", "600000.SH", "600036.SH", "000001.SZ", 
                     "000002.SZ", "000651.SZ"]
    conn.execute(f"""
        COPY (
            SELECT * FROM daily
            WHERE ts_code IN ({','.join(['?']*len(sample_stocks))})
            ORDER BY ts_code, trade_date
        ) TO '{OUTPUT_DIR}/sample_daily.parquet' (FORMAT PARQUET)
    """, sample_stocks)
    
    conn.execute(f"""
        COPY (
            SELECT * FROM index_daily
            WHERE ts_code IN ('000001.SH','399001.SZ','399006.SZ','000300.SH','000852.SH','000688.SH')
            ORDER BY ts_code, trade_date
        ) TO '{OUTPUT_DIR}/index_daily.parquet' (FORMAT PARQUET)
    """)
    
    conn.execute(f"""
        COPY (
            SELECT * FROM corporate_actions
            ORDER BY ts_code, ex_date
        ) TO '{OUTPUT_DIR}/corporate_actions.parquet' (FORMAT PARQUET)
    """)
    
    conn.execute(f"""
        COPY (
            SELECT * FROM trade_cal
            WHERE is_open=true
            ORDER BY exchange, cal_date
        ) TO '{OUTPUT_DIR}/trade_cal.parquet' (FORMAT PARQUET)
    """)
    
    # 计算文件哈希
    for file_path in OUTPUT_DIR.glob("*"):
        if file_path.is_file():
            manifest["files"][file_path.name] = {
                "sha256": file_hash(file_path),
                "size": file_path.stat().st_size
            }
    
    # 写入 manifest.json
    with open(OUTPUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    print(f"发布包已生成到 {OUTPUT_DIR}")
    print("包含文件:")
    for f in OUTPUT_DIR.glob("*"):
        print(f"  {f.name} ({f.stat().st_size} bytes)")
    
    conn.close()

if __name__ == '__main__':
    main()