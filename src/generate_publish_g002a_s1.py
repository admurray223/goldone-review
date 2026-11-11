#!/usr/bin/env python3
"""
GoldOne G002A-S1 生成发布包 - 安全修复版
新增字段：
- market_scope
- sample_mode
- coverage_ratio
- publishability
- unavailable_metrics
- data_quality_status
- 动态 stale_after
- 真实 SHA-256
- 无本地路径/凭证
"""
import duckdb
import json
import hashlib
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional

DB_PATH = "/Users/z/GoldOne/data/goldone_g002a_s1.duckdb"
OUTPUT_DIR = Path("/Users/z/GoldOne/outputs/publish/latest")

def file_hash(path: Path) -> str:
    """计算文件 SHA256"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def get_db_size(db_path: str) -> Dict[str, int]:
    """获取数据库文件大小和业务数据大小估算"""
    file_size = os.path.getsize(db_path)
    # 业务数据大小估算：文件大小减去元数据开销（约 10%）
    business_size = int(file_size * 0.9)
    return {"file_size_bytes": file_size, "business_size_bytes": business_size}

def get_latest_successful_ingestion_run(conn: duckdb.DuckDBPyConnection) -> Optional[Dict]:
    """获取最近成功的摄入运行（排除 quality_check）"""
    row = conn.execute("""
        SELECT run_id, completed_at, api_calls, rows_inserted, data_as_of
        FROM ingestion_runs
        WHERE status='completed' AND run_type IN ('sample', 'full', 'incremental', 'backfill')
        ORDER BY completed_at DESC
        LIMIT 1
    """).fetchone()
    if row:
        return {
            "run_id": row[0],
            "completed_at": row[1].isoformat() if row[1] else None,
            "api_calls": row[2],
            "rows_inserted": row[3],
            "data_as_of": str(row[4]) if row[4] else None
        }
    return None

def get_latest_quality_run(conn: duckdb.DuckDBPyConnection) -> Optional[Dict]:
    """获取最近的质量检查运行"""
    row = conn.execute("""
        SELECT run_id, completed_at, rows_inserted as issue_count
        FROM ingestion_runs
        WHERE run_type='quality_check' AND status='completed'
        ORDER BY completed_at DESC
        LIMIT 1
    """).fetchone()
    if row:
        return {
            "run_id": row[0],
            "completed_at": row[1].isoformat() if row[1] else None,
            "issue_count": row[2]
        }
    return None

def get_quality_issues_summary(conn: duckdb.DuckDBPyConnection, quality_run_id: str) -> Dict:
    """获取质量问题统计"""
    rows = conn.execute("""
        SELECT severity, COUNT(*) FROM data_quality_issues
        WHERE ingestion_run_id = ? GROUP BY severity
    """, [quality_run_id]).fetchall()
    quality_dict = {row[0]: row[1] for row in rows}
    return {
        "critical": quality_dict.get("critical", 0),
        "warning": quality_dict.get("warning", 0),
        "info": quality_dict.get("info", 0),
        "total": sum(quality_dict.values())
    }

def get_data_quality_status(conn: duckdb.DuckDBPyConnection, quality_run_id: str) -> str:
    """获取质量门禁状态"""
    row = conn.execute("""
        SELECT quality_gate FROM data_quality_issues
        WHERE ingestion_run_id = ? AND quality_gate IS NOT NULL
        LIMIT 1
    """, [quality_run_id]).fetchone()
    return row[0] if row else "unknown"

def get_market_coverage_ratio(conn: duckdb.DuckDBPyConnection) -> float:
    """计算市场覆盖率（最近交易日）"""
    latest_date = conn.execute("SELECT MAX(trade_date) FROM daily").fetchone()[0]
    if not latest_date:
        return 0.0
    total_stocks = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE market IN ('SH','SZ')").fetchone()[0]
    traded = conn.execute("""
        SELECT COUNT(DISTINCT ts_code) FROM daily WHERE trade_date = ? AND data_source = 'hithink'
    """, [latest_date]).fetchone()[0]
    return traded / total_stocks if total_stocks > 0 else 0.0

def get_unavailable_metrics(conn: duckdb.DuckDBPyConnection) -> list:
    """获取不可用指标列表"""
    unavailable = []

    # 检查 adj_factor
    adj_count = conn.execute("SELECT COUNT(*) FROM adj_factor").fetchone()[0]
    if adj_count == 0:
        unavailable.append("adj_factor")

    # 检查 financials
    fin_count = conn.execute("SELECT COUNT(*) FROM financials").fetchone()[0]
    if fin_count == 0:
        unavailable.append("financials")

    # 检查 list_date/delist_date
    no_list_date = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE list_date IS NULL").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM stock_basic").fetchone()[0]
    if no_list_date == total:
        unavailable.append("historical_stock_pool")

    # 检查 delisted stocks
    delisted = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE list_status = 'D'").fetchone()[0]
    if delisted == 0:
        unavailable.append("delisted_stocks")

    # 检查 MA20/MA60 历史深度
    max_history = conn.execute("""
        SELECT COUNT(DISTINCT trade_date) FROM daily WHERE ts_code = (SELECT ts_code FROM daily LIMIT 1)
    """).fetchone()[0]
    if max_history and max_history < 20:
        unavailable.append("ma20")
    if max_history and max_history < 60:
        unavailable.append("ma60")

    return unavailable

def export_parquet_files(conn: duckdb.DuckDBPyConnection, output_dir: Path):
    """导出必要的 Parquet 文件"""
    # 样本股（最近 80 个交易日的前 10 只）
    sample_stocks = [row[0] for row in conn.execute("""
        SELECT ts_code FROM stock_basic WHERE market IN ('SH','SZ') ORDER BY ts_code LIMIT 10
    """).fetchall()]

    trade_dates = [row[0] for row in conn.execute("""
        SELECT cal_date FROM trade_cal WHERE exchange='SH' AND is_open=true ORDER BY cal_date DESC LIMIT 80
    """).fetchall()]
    date_filter = "(" + ",".join([f"'{d}'" for d in trade_dates]) + ")" if trade_dates else "('2026-01-01')"

    # 样本股日线
    placeholders = ",".join(["?"] * len(sample_stocks))
    conn.execute(f"""
        COPY (
            SELECT * FROM daily
            WHERE ts_code IN ({placeholders}) AND trade_date IN {date_filter}
            ORDER BY ts_code, trade_date
        ) TO '{output_dir}/sample_daily.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """, sample_stocks)

    # 指数日线
    index_codes = ["000001.SH", "399001.SZ", "399006.SZ", "000300.SH", "000852.SH", "000688.SH"]
    placeholders = ",".join(["?"] * len(index_codes))
    conn.execute(f"""
        COPY (
            SELECT * FROM index_daily
            WHERE ts_code IN ({placeholders}) AND trade_date IN {date_filter}
            ORDER BY ts_code, trade_date
        ) TO '{output_dir}/index_daily.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """, index_codes)

    # 公司行为
    conn.execute(f"""
        COPY (
            SELECT * FROM corporate_actions
            ORDER BY ts_code, ex_date
        ) TO '{output_dir}/corporate_actions.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    # 交易日历
    conn.execute(f"""
        COPY (
            SELECT * FROM trade_cal
            WHERE is_open=true
            ORDER BY exchange, cal_date
        ) TO '{output_dir}/trade_cal.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(DB_PATH)

    try:
        # 1. 获取最新成功摄入运行
        last_run = get_latest_successful_ingestion_run(conn)

        # 2. 获取质量检查运行
        quality_run = get_latest_quality_run(conn)
        quality_issues = {}
        data_quality_status = "unknown"
        if quality_run:
            quality_issues = get_quality_issues_summary(conn, quality_run["run_id"])
            data_quality_status = get_data_quality_status(conn, quality_run["run_id"])

        # 3. 统计表行数
        table_counts = {}
        for table in ['ingestion_runs', 'stock_basic', 'trade_cal', 'daily', 'adj_factor',
                      'index_daily', 'financials', 'corporate_actions', 'data_quality_issues',
                      'market_breadth', 'api_call_counter']:
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                table_counts[table] = count
            except:
                table_counts[table] = 0

        # 4. 市场摘要（最新交易日）
        latest_date = conn.execute("SELECT MAX(trade_date) FROM daily WHERE data_source='hithink'").fetchone()[0]
        if latest_date:
            market_summary = conn.execute("""
                SELECT
                    COUNT(*) as traded_count,
                    SUM(CASE WHEN close > pre_close THEN 1 ELSE 0 END) as up_count,
                    SUM(CASE WHEN close < pre_close THEN 1 ELSE 0 END) as down_count,
                    SUM(CASE WHEN close = pre_close THEN 1 ELSE 0 END) as flat_count,
                    SUM(amount) as total_amount
                FROM daily
                WHERE trade_date = ? AND data_source = 'hithink'
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

        # 5. 指数状态
        index_status = []
        for row in conn.execute("""
            SELECT ts_code, MAX(trade_date) as latest_date,
                   COUNT(*) as data_points
            FROM index_daily
            WHERE data_source = 'hithink'
            GROUP BY ts_code
        """).fetchall():
            index_status.append({
                "ts_code": row[0],
                "latest_date": str(row[1]),
                "data_points": row[2]
            })

        # 6. 覆盖率
        coverage_ratio = get_market_coverage_ratio(conn)

        # 7. 不可用指标
        unavailable_metrics = get_unavailable_metrics(conn)

        # 8. 样本模式判断
        total_stocks = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE market IN ('SH','SZ')").fetchone()[0]
        sample_mode = total_stocks > 0 and coverage_ratio < 0.95

        # 9. 发布性判断
        if data_quality_status == "failed":
            publishability = "sample_only"
        elif data_quality_status == "incomplete" or sample_mode:
            publishability = "partial"
        else:
            publishability = "full"

        # 10. 动态 stale_after (生成时间 + 7 天)
        generated_at = datetime.now()
        stale_after = (generated_at + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)

        # 11. 数据库大小
        db_sizes = get_db_size(DB_PATH)

        # 12. 导出 Parquet 文件
        print("导出 Parquet 文件...")
        export_parquet_files(conn, OUTPUT_DIR)

        # 13. 生成 manifest.json
        manifest = {
            "schema_version": "1.0.0",
            "generated_at": generated_at.isoformat(),
            "data_as_of": str(latest_date) if latest_date else None,
            "market_scope": ["SH", "SZ"],
            "sample_mode": sample_mode,
            "coverage_ratio": round(coverage_ratio, 4),
            "publishability": publishability,
            "unavailable_metrics": unavailable_metrics,
            "data_quality_status": data_quality_status,
            "last_successful_run": last_run,
            "quality_gate": {
                "run_id": quality_run["run_id"] if quality_run else None,
                "completed_at": quality_run["completed_at"] if quality_run else None,
                "issues": quality_issues
            } if quality_run else None,
            "stale_after": stale_after.isoformat(),
            "source_summary": {
                "tables": table_counts,
                "data_sources": ["hithink"],
                "date_range": {
                    "daily": {"start": "2026-07-15", "end": str(latest_date) if latest_date else "2026-11-11"},
                    "index_daily": {"start": "2026-07-15", "end": str(latest_date) if latest_date else "2026-11-11"},
                    "trade_cal": {"start": "2025-11-11", "end": "2026-11-11"}
                }
            },
            "db_info": {
                "file_size_bytes": db_sizes["file_size_bytes"],
                "business_size_bytes": db_sizes["business_size_bytes"]
            },
            "files": {}
        }

        # 14. 市场摘要
        with open(OUTPUT_DIR / "market_summary.json", "w") as f:
            json.dump(market_summary_dict, f, ensure_ascii=False, indent=2)

        # 15. 指数状态
        with open(OUTPUT_DIR / "index_status.json", "w") as f:
            json.dump({"indices": index_status, "updated_at": generated_at.isoformat()}, f, ensure_ascii=False, indent=2)

        # 16. 读取市场宽度
        breadth_path = OUTPUT_DIR / "breadth_summary.json"
        if breadth_path.exists():
            with open(breadth_path) as f:
                breadth_data = json.load(f)
        else:
            breadth_data = {}

        # 17. 质量状态
        quality_status = {
            "checked_at": quality_run["completed_at"] if quality_run else generated_at.isoformat(),
            "issues": quality_issues,
            "total_issues": sum(quality_issues.values()),
            "data_quality_status": data_quality_status
        }
        with open(OUTPUT_DIR / "quality_status.json", "w") as f:
            json.dump(quality_status, f, ensure_ascii=False, indent=2)

        # 18. 计算文件哈希
        for file_path in OUTPUT_DIR.glob("*"):
            if file_path.is_file():
                manifest["files"][file_path.name] = {
                    "sha256": file_hash(file_path),
                    "size": file_path.stat().st_size
                }

        # 19. 写入 manifest.json
        with open(OUTPUT_DIR / "manifest.json", "w") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        print(f"发布包已生成到 {OUTPUT_DIR}")
        print("包含文件:")
        for f in sorted(OUTPUT_DIR.glob("*")):
            if f.is_file():
                print(f"  {f.name} ({f.stat().st_size} bytes)")

        # 保存发布包记录到数据库
        package_id = hashlib.sha256(generated_at.isoformat().encode()).hexdigest()[:16]
        conn.execute("""
            INSERT INTO publish_package
            (package_id, schema_version, generated_at, data_as_of, market_scope, sample_mode,
             coverage_ratio, publishability, unavailable_metrics, data_quality_status,
             stale_after, db_file_size_bytes, db_business_size_bytes, manifest_sha256,
             ingestion_run_id, quality_run_id, files_manifest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            package_id, "1.0.0", generated_at, str(latest_date) if latest_date else None,
            json.dumps(["SH", "SZ"]), sample_mode, round(coverage_ratio, 4), publishability,
            json.dumps(unavailable_metrics), data_quality_status,
            stale_after, db_sizes["file_size_bytes"], db_sizes["business_size_bytes"],
            file_hash(OUTPUT_DIR / "manifest.json"),
            last_run["run_id"] if last_run else None,
            quality_run["run_id"] if quality_run else None,
            json.dumps(manifest["files"])
        ])

    finally:
        conn.close()

if __name__ == '__main__':
    main()