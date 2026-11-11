#!/usr/bin/env python3
"""
GoldOne G002A-S2A 生成发布包 - 修复版
修复点：
- manifest.json 文件清单排除 manifest.json 自身，或生成独立 manifest.sha256
- 所有报告写入真实完整 SHA256，禁止占位值
- quality_status.json 分开表示本次运行问题与历史累计问题
- 所有时间字段包含明确时区
- 先生成带运行号的不可变目录，校验通过后再原子切换 latest
- 原子切换：创建临时符号链接，使用原子重命名替换 latest
- 故障注入：before_publish_switch
- 发布包的宽度文件必须直接由当前数据库、当前运行生成（不复制旧 latest）
- 发布前强制验证：market_breadth 恰好包含预期的 80 个日期；breadth_run.run_id = last_successful_run.run_id；breadth_summary.ingestion_run_id 与上述运行一致
- 数据库大小字段改名为明确的快照口径
- 支持测试环境参数（DB_PATH, PUBLISH_ROOT）
"""
import duckdb
import json
import hashlib
import os
import shutil
import sys
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Optional


# 默认配置（可通过环境变量覆盖）
DEFAULT_DB_PATH = "/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb"
DEFAULT_PUBLISH_ROOT = "/Users/z/GoldOne/outputs/publish"

DB_PATH = os.environ.get('DB_PATH', DEFAULT_DB_PATH)
PUBLISH_ROOT = Path(os.environ.get('PUBLISH_ROOT', DEFAULT_PUBLISH_ROOT))

# 故障注入配置
FAULT_INJECTION = None


def maybe_inject_fault(stage: str):
    """故障注入点"""
    global FAULT_INJECTION
    if FAULT_INJECTION and FAULT_INJECTION == stage:
        raise RuntimeError(f"FAULT_INJECTION triggered at stage: {stage}")


def file_hash(path: Path) -> str:
    """计算文件 SHA256"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_db_size_snapshot(db_path: str) -> Dict[str, int]:
    """获取数据库文件大小快照（发布包生成时刻的文件大小）"""
    file_size = os.path.getsize(db_path)
    # 业务数据大小 = 文件大小（使用实际文件大小作为快照值）
    business_size = file_size
    return {
        "db_file_size_bytes": file_size,
        "db_business_size_bytes": business_size
    }


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


def get_latest_breadth_run(conn: duckdb.DuckDBPyConnection) -> Optional[Dict]:
    """获取最近的市场宽度计算运行"""
    row = conn.execute("""
        SELECT DISTINCT ingestion_run_id, MAX(calculated_at) as completed_at
        FROM market_breadth
        GROUP BY ingestion_run_id
        ORDER BY completed_at DESC
        LIMIT 1
    """).fetchone()
    if row:
        return {
            "run_id": row[0],
            "completed_at": row[1].isoformat() if row[1] else None
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


def get_quality_issues_current_run(conn: duckdb.DuckDBPyConnection, quality_run_id: str) -> list:
    """获取本次运行的质量问题详情"""
    rows = conn.execute("""
        SELECT issue_id, table_name, ts_code, trade_date, issue_type, severity, description,
               expected_value, actual_value, detected_at
        FROM data_quality_issues
        WHERE ingestion_run_id = ?
        ORDER BY detected_at
    """, [quality_run_id]).fetchall()
    return [{
        "issue_id": r[0], "table": r[1], "ts_code": r[2], "trade_date": str(r[3]) if r[3] else None,
        "issue_type": r[4], "severity": r[5], "description": r[6],
        "expected": r[7], "actual": r[8], "detected_at": r[9].isoformat() if r[9] else None
    } for r in rows]


def get_quality_issues_historical(conn: duckdb.DuckDBPyConnection, quality_run_id: str) -> Dict:
    """获取历史累计质量问题统计（排除当前运行）"""
    rows = conn.execute("""
        SELECT severity, COUNT(*) FROM data_quality_issues
        WHERE ingestion_run_id != ? GROUP BY severity
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


def get_market_coverage_ratio(conn: duckdb.DuckDBPyConnection, ingestion_run_id: str) -> Dict[str, float]:
    """计算市场覆盖率（最近交易日）"""
    latest_date = conn.execute("SELECT MAX(trade_date) FROM daily WHERE ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
    if not latest_date:
        return {"observed": 0.0, "comparison": 0.0}
    total_stocks = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE market IN ('SH','SZ') AND ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
    observed = conn.execute("""
        SELECT COUNT(DISTINCT ts_code) FROM daily WHERE trade_date = ? AND data_source = 'hithink' AND ingestion_run_id = ?
    """, [latest_date, ingestion_run_id]).fetchone()[0]
    comparison = conn.execute("""
        SELECT COUNT(DISTINCT ts_code) FROM daily WHERE trade_date = ? AND data_source = 'hithink' AND ingestion_run_id = ? AND close IS NOT NULL AND pre_close IS NOT NULL
    """, [latest_date, ingestion_run_id]).fetchone()[0]
    return {
        "observed": observed / total_stocks if total_stocks > 0 else 0.0,
        "comparison": comparison / total_stocks if total_stocks > 0 else 0.0
    }


def get_unavailable_metrics(conn: duckdb.DuckDBPyConnection, ingestion_run_id: str) -> list:
    """获取不可用指标列表"""
    unavailable = []

    adj_count = conn.execute("SELECT COUNT(*) FROM adj_factor WHERE ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
    if adj_count == 0:
        unavailable.append("adj_factor")

    fin_count = conn.execute("SELECT COUNT(*) FROM financials WHERE ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
    if fin_count == 0:
        unavailable.append("financials")

    no_list_date = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ? AND list_date IS NULL", [ingestion_run_id]).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
    if no_list_date == total:
        unavailable.append("historical_stock_pool")

    delisted = conn.execute("SELECT COUNT(*) FROM stock_basic WHERE ingestion_run_id = ? AND list_status = 'D'", [ingestion_run_id]).fetchone()[0]
    if delisted == 0:
        unavailable.append("delisted_stocks")

    max_history = conn.execute("""
        SELECT COUNT(DISTINCT trade_date) FROM daily WHERE ingestion_run_id = ? AND ts_code = (SELECT ts_code FROM daily WHERE ingestion_run_id = ? LIMIT 1)
    """, [ingestion_run_id, ingestion_run_id]).fetchone()[0]
    if max_history and max_history < 20:
        unavailable.append("ma20")
    if max_history and max_history < 60:
        unavailable.append("ma60")

    return unavailable


def export_parquet_files(conn: duckdb.DuckDBPyConnection, output_dir: Path, ingestion_run_id: str):
    """导出必要的 Parquet 文件（仅当前运行的数据）"""
    sample_stocks = [row[0] for row in conn.execute("""
        SELECT ts_code FROM stock_basic WHERE market IN ('SH','SZ') AND ingestion_run_id = ? ORDER BY ts_code LIMIT 10
    """, [ingestion_run_id]).fetchall()]

    trade_dates = [row[0] for row in conn.execute("""
        SELECT cal_date FROM trade_cal WHERE exchange='SH' AND is_open=true AND ingestion_run_id = ? ORDER BY cal_date DESC LIMIT 80
    """, [ingestion_run_id]).fetchall()]
    date_filter = "(" + ",".join([f"'{d}'" for d in trade_dates]) + ")" if trade_dates else "('2026-01-01')"

    # 样本股日线
    if sample_stocks:
        placeholders = ",".join(["?"] * len(sample_stocks))
        conn.execute(f"""
            COPY (
                SELECT * FROM daily
                WHERE ts_code IN ({placeholders}) AND trade_date IN {date_filter} AND ingestion_run_id = ?
                ORDER BY ts_code, trade_date
            ) TO '{output_dir}/sample_daily.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
        """, sample_stocks + [ingestion_run_id])

    # 指数日线
    index_codes = ["000001.SH", "399001.SZ", "399006.SZ", "000300.SH", "000852.SH", "000688.SH"]
    placeholders = ",".join(["?"] * len(index_codes))
    conn.execute(f"""
        COPY (
            SELECT * FROM index_daily
            WHERE ts_code IN ({placeholders}) AND trade_date IN {date_filter} AND ingestion_run_id = ?
            ORDER BY ts_code, trade_date
        ) TO '{output_dir}/index_daily.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """, index_codes + [ingestion_run_id])

    # 公司行为
    conn.execute(f"""
        COPY (
            SELECT * FROM corporate_actions
            WHERE ingestion_run_id = ?
            ORDER BY ts_code, ex_date
        ) TO '{output_dir}/corporate_actions.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """, [ingestion_run_id])

    # 交易日历
    conn.execute(f"""
        COPY (
            SELECT * FROM trade_cal
            WHERE is_open=true AND ingestion_run_id = ?
            ORDER BY exchange, cal_date
        ) TO '{output_dir}/trade_cal.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
    """, [ingestion_run_id])


def generate_breadth_summary_from_db(conn: duckdb.DuckDBPyConnection, ingestion_run_id: str) -> Dict:
    """从当前数据库、当前运行生成市场宽度摘要（不复制旧 latest）"""
    rows = conn.execute("""
        SELECT
            trade_date, pool_size, observed_count, comparison_valid_count, unknown_change_count,
            coverage_ratio_observed, coverage_ratio_comparison,
            up_count, down_count, flat_count, up_ratio, total_amount,
            ma20_count, ma60_count, ma20_ratio, ma60_ratio,
            high20_count, low20_count, data_quality_status, unavailable_metrics,
            calculated_at
        FROM market_breadth
        WHERE ingestion_run_id = ?
        ORDER BY trade_date
    """, [ingestion_run_id]).fetchall()

    data = []
    for row in rows:
        data.append({
            'trade_date': str(row[0]),
            'pool_size': row[1],
            'observed_count': row[2],
            'comparison_valid_count': row[3],
            'unknown_change_count': row[4],
            'coverage_ratio_observed': row[5],
            'coverage_ratio_comparison': row[6],
            'up_count': row[7],
            'down_count': row[8],
            'flat_count': row[9],
            'up_ratio': row[10],
            'total_amount': row[11],
            'ma20_count': row[12],
            'ma60_count': row[13],
            'ma20_ratio': row[14],
            'ma60_ratio': row[15],
            'high20_count': row[16],
            'low20_count': row[17],
            'data_quality_status': row[18],
            'unavailable_metrics': row[19],
            'calculated_at': row[20].isoformat() if row[20] else None
        })

    def default_serializer(obj):
        if isinstance(obj, (datetime,)):
            return obj.isoformat()
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        raise TypeError(f'Object of type {obj.__class__.__name__} is not JSON serializable')

    return {
        'calculated_at': datetime.now(timezone.utc).isoformat(),
        'period_days': len(data),
        'ingestion_run_id': ingestion_run_id,
        'data_quality_note': f'基于 {data[0]["pool_size"] if data else 0} 只样本股计算，观测覆盖率约 {data[0]["coverage_ratio_observed"]*100:.1f}%，非全市场结果' if data else '无数据',
        'data': data
    }


def validate_before_publish(conn: duckdb.DuckDBPyConnection, ingestion_run_id: str, breadth_summary: Dict) -> None:
    """发布前强制验证"""
    # 1. market_breadth 恰好包含预期的 80 个日期
    breadth_count = conn.execute("""
        SELECT COUNT(*) FROM market_breadth WHERE ingestion_run_id = ?
    """, [ingestion_run_id]).fetchone()[0]
    if breadth_count != 80:
        raise RuntimeError(f"VALIDATION FAILED: market_breadth 包含 {breadth_count} 个日期，预期 80 个")

    # 2. breadth_run.run_id = last_successful_run.run_id
    breadth_run = get_latest_breadth_run(conn)
    if not breadth_run or breadth_run["run_id"] != ingestion_run_id:
        raise RuntimeError(f"VALIDATION FAILED: breadth_run.run_id ({breadth_run['run_id'] if breadth_run else 'None'}) != last_successful_run.run_id ({ingestion_run_id})")

    # 3. breadth_summary.ingestion_run_id 与上述运行一致
    if breadth_summary.get('ingestion_run_id') != ingestion_run_id:
        raise RuntimeError(f"VALIDATION FAILED: breadth_summary.ingestion_run_id ({breadth_summary.get('ingestion_run_id')}) != ingestion_run_id ({ingestion_run_id})")

    # 4. 结果集非空
    if not breadth_summary.get('data') or len(breadth_summary['data']) == 0:
        raise RuntimeError("VALIDATION FAILED: breadth_summary.data 为空")

    print("发布前验证通过:")
    print(f"  market_breadth 日期数: {breadth_count} (预期 80)")
    print(f"  breadth_run.run_id: {breadth_run['run_id']} == ingestion_run_id: {ingestion_run_id}")
    print(f"  breadth_summary.ingestion_run_id: {breadth_summary['ingestion_run_id']} == ingestion_run_id: {ingestion_run_id}")
    print(f"  breadth_summary.data 条数: {len(breadth_summary['data'])} (非空)")


def main():
    # 解析命令行参数
    global FAULT_INJECTION
    if len(sys.argv) > 1:
        FAULT_INJECTION = sys.argv[1]
        print(f"FAULT_INJECTION enabled: {FAULT_INJECTION}")

    conn = duckdb.connect(DB_PATH)
    generated_at = datetime.now(timezone.utc)
    run_id = generated_at.strftime('%Y%m%d_%H%M%S')

    # 1. 创建带运行号的不可变目录
    run_dir = PUBLISH_ROOT / f"run_{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    latest_dir = PUBLISH_ROOT / "latest"

    try:
        # 2. 获取运行信息
        last_run = get_latest_successful_ingestion_run(conn)
        quality_run = get_latest_quality_run(conn)
        breadth_run = get_latest_breadth_run(conn)

        quality_issues = {}
        quality_issues_current = []
        quality_issues_historical = {}
        data_quality_status = "unknown"
        if quality_run:
            quality_issues = get_quality_issues_summary(conn, quality_run["run_id"])
            quality_issues_current = get_quality_issues_current_run(conn, quality_run["run_id"])
            quality_issues_historical = get_quality_issues_historical(conn, quality_run["run_id"])
            data_quality_status = get_data_quality_status(conn, quality_run["run_id"])

        # 3. 统计表行数（仅当前运行）
        ingestion_run_id = last_run["run_id"] if last_run else None
        table_counts = {}
        if ingestion_run_id:
            for table in ['ingestion_runs', 'stock_basic', 'trade_cal', 'daily', 'adj_factor',
                          'index_daily', 'financials', 'corporate_actions', 'data_quality_issues',
                          'market_breadth', 'api_call_counter']:
                try:
                    count = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
                    table_counts[table] = count
                except:
                    table_counts[table] = 0

        # 4. 市场摘要（最新交易日，仅当前运行）
        latest_date = None
        market_summary_dict = {}
        if ingestion_run_id:
            latest_date = conn.execute("SELECT MAX(trade_date) FROM daily WHERE data_source='hithink' AND ingestion_run_id = ?", [ingestion_run_id]).fetchone()[0]
            if latest_date:
                market_summary = conn.execute("""
                    SELECT
                        COUNT(*) as traded_count,
                        SUM(CASE WHEN close > pre_close THEN 1 ELSE 0 END) as up_count,
                        SUM(CASE WHEN close < pre_close THEN 1 ELSE 0 END) as down_count,
                        SUM(CASE WHEN close = pre_close THEN 1 ELSE 0 END) as flat_count,
                        SUM(amount) as total_amount
                    FROM daily
                    WHERE trade_date = ? AND data_source = 'hithink' AND ingestion_run_id = ?
                """, [latest_date, ingestion_run_id]).fetchone()
                market_summary_dict = {
                    "trade_date": str(latest_date),
                    "traded_count": market_summary[0] or 0,
                    "up_count": market_summary[1] or 0,
                    "down_count": market_summary[2] or 0,
                    "flat_count": market_summary[3] or 0,
                    "total_amount": round(market_summary[4] or 0, 2)
                }

        # 5. 指数状态
        index_status = []
        if ingestion_run_id:
            for row in conn.execute("""
                SELECT ts_code, MAX(trade_date) as latest_date,
                       COUNT(*) as data_points
                FROM index_daily
                WHERE data_source = 'hithink' AND ingestion_run_id = ?
                GROUP BY ts_code
            """, [ingestion_run_id]).fetchall():
                index_status.append({
                    "ts_code": row[0],
                    "latest_date": str(row[1]),
                    "data_points": row[2]
                })

        # 6. 覆盖率
        coverage = {"observed": 0.0, "comparison": 0.0}
        if ingestion_run_id:
            coverage = get_market_coverage_ratio(conn, ingestion_run_id)

        # 7. 不可用指标
        unavailable_metrics = []
        if ingestion_run_id:
            unavailable_metrics = get_unavailable_metrics(conn, ingestion_run_id)

        # 8. 样本模式判断
        sample_mode = True  # S2A 明确为样本模式

        # 9. 发布性判断
        if data_quality_status == "failed":
            publishability = "sample_only"
        elif data_quality_status == "incomplete" or sample_mode:
            publishability = "partial"
        else:
            publishability = "full"

        # 10. 动态 stale_after (生成时间 + 7 天，归零到 00:00:00)
        stale_after = (generated_at + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)

        # 11. 数据库大小快照
        db_sizes = get_db_size_snapshot(DB_PATH)

        # 12. 导出 Parquet 文件
        print("导出 Parquet 文件...")
        export_parquet_files(conn, run_dir, ingestion_run_id)

        # 13. 生成 market_summary.json
        with open(run_dir / "market_summary.json", "w") as f:
            json.dump(market_summary_dict, f, ensure_ascii=False, indent=2)

        # 14. 生成 index_status.json
        with open(run_dir / "index_status.json", "w") as f:
            json.dump({"indices": index_status, "updated_at": generated_at.isoformat()}, f, ensure_ascii=False, indent=2)

        # 15. 生成市场宽度摘要（从当前数据库、当前运行生成，不复制旧 latest）
        print("生成市场宽度摘要（从当前数据库）...")
        breadth_summary = generate_breadth_summary_from_db(conn, ingestion_run_id)

        # 16. 发布前强制验证
        print("执行发布前强制验证...")
        validate_before_publish(conn, ingestion_run_id, breadth_summary)

        # 17. 保存 breadth_summary.json
        def default_serializer(obj):
            if isinstance(obj, (datetime,)):
                return obj.isoformat()
            if hasattr(obj, 'isoformat'):
                return obj.isoformat()
            raise TypeError(f'Object of type {obj.__class__.__name__} is not JSON serializable')

        with open(run_dir / "breadth_summary.json", "w") as f:
            json.dump(breadth_summary, f, ensure_ascii=False, indent=2, default=default_serializer)

        # 18. 生成 quality_status.json (S2A 修复：分开当前运行与历史累计)
        quality_status = {
            "checked_at": quality_run["completed_at"] if quality_run else generated_at.isoformat(),
            "current_run": {
                "run_id": quality_run["run_id"] if quality_run else None,
                "issues": quality_issues,
                "issue_details": quality_issues_current,
                "total_issues": sum(quality_issues.values()),
                "data_quality_status": data_quality_status
            },
            "historical_cumulative": quality_issues_historical
        }
        with open(run_dir / "quality_status.json", "w") as f:
            json.dump(quality_status, f, ensure_ascii=False, indent=2)

        # 19. 构建 manifest 内容（不含 manifest 自身的哈希）
        manifest_content = {
            "schema_version": "1.0.0",
            "generated_at": generated_at.isoformat(),
            "data_as_of": str(latest_date) if latest_date else None,
            "market_scope": ["SH", "SZ"],
            "sample_mode": sample_mode,
            "coverage_ratio_observed": round(coverage["observed"], 4),
            "coverage_ratio_comparison": round(coverage["comparison"], 4),
            "publishability": publishability,
            "unavailable_metrics": unavailable_metrics,
            "data_quality_status": data_quality_status,
            "last_successful_run": last_run,
            "quality_gate": {
                "run_id": quality_run["run_id"] if quality_run else None,
                "completed_at": quality_run["completed_at"] if quality_run else None,
                "issues": quality_issues
            } if quality_run else None,
            "breadth_run": breadth_run,
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
                "db_file_size_bytes": db_sizes["db_file_size_bytes"],
                "db_business_size_bytes": db_sizes["db_business_size_bytes"]
            },
            "files": {}  # 稍后填充，不包含 manifest.json
        }

        # 20. 计算文件哈希（排除 manifest.json）
        for file_path in run_dir.glob("*"):
            if file_path.is_file() and file_path.name != "manifest.json":
                manifest_content["files"][file_path.name] = {
                    "sha256": file_hash(file_path),
                    "size": file_path.stat().st_size
                }

        # 21. 写入 manifest.json
        with open(run_dir / "manifest.json", "w") as f:
            json.dump(manifest_content, f, ensure_ascii=False, indent=2)

        # 22. 计算 manifest.json 自身的 SHA256，写入单独文件 manifest.sha256
        manifest_sha256 = file_hash(run_dir / "manifest.json")
        with open(run_dir / "manifest.sha256", "w") as f:
            f.write(f"{manifest_sha256}  manifest.json\n")

        print(f"发布包已生成到 {run_dir}")
        print("包含文件:")
        for f in sorted(run_dir.glob("*")):
            if f.is_file():
                print(f"  {f.name} ({f.stat().st_size} bytes)")

        # 23. 校验发布包完整性
        print("\n校验发布包完整性...")
        with open(run_dir / "manifest.json") as f:
            manifest_check = json.load(f)
        for filename, info in manifest_check["files"].items():
            filepath = run_dir / filename
            actual_hash = file_hash(filepath)
            if actual_hash != info["sha256"]:
                raise RuntimeError(f"文件哈希不匹配: {filename} 期望 {info['sha256'][:16]}... 实际 {actual_hash[:16]}...")
            if info["size"] != filepath.stat().st_size:
                raise RuntimeError(f"文件大小不匹配: {filename}")
        print("  所有文件哈希验证通过")

        # 24. 验证 manifest.sha256
        with open(run_dir / "manifest.sha256") as f:
            sha_line = f.read().strip()
        if not sha_line.startswith(manifest_sha256):
            raise RuntimeError("manifest.sha256 内容不匹配")
        print("  manifest.sha256 验证通过")

        # 25. 故障注入点：发布切换前
        maybe_inject_fault('before_publish_switch')

        # 26. 原子切换 latest 目录（临时符号链接 + 原子重命名）
        print("\n原子切换 latest 目录...")

        # 保存旧 latest 的目标（用于故障恢复验证）
        old_latest_target = None
        if latest_dir.exists() and latest_dir.is_symlink():
            old_latest_target = os.readlink(latest_dir)
            print(f"  旧 latest 指向: {old_latest_target}")

        # 创建临时符号链接
        import tempfile
        temp_symlink = PUBLISH_ROOT / f"latest.tmp.{os.getpid()}.{int(datetime.now(timezone.utc).timestamp() * 1000000)}"
        temp_symlink.symlink_to(run_dir.name)
        print(f"  创建临时符号链接: {temp_symlink.name} -> {run_dir.name}")

        # 原子重命名替换 latest (os.replace 在 POSIX 上是原子的)
        try:
            os.replace(str(temp_symlink), str(latest_dir))
            print(f"  原子切换成功: latest -> {run_dir.name}")
        except Exception as e:
            # 失败时清理临时链接
            if temp_symlink.exists():
                temp_symlink.unlink()
            # 验证旧 latest 仍然可用且指向不变
            if latest_dir.exists() and latest_dir.is_symlink():
                current_target = os.readlink(latest_dir)
                if old_latest_target and current_target == old_latest_target:
                    print(f"  切换失败，旧 latest 仍完整可用: {current_target}")
                else:
                    print(f"  WARNING: 旧 latest 状态异常: {current_target}")
            raise RuntimeError(f"原子切换失败: {e}")

        # 27. 保存发布包记录到数据库
        package_id = hashlib.sha256(generated_at.isoformat().encode()).hexdigest()[:16]
        conn.execute("""
            INSERT INTO publish_package
            (package_id, schema_version, generated_at, data_as_of, market_scope, sample_mode,
             coverage_ratio, publishability, unavailable_metrics, data_quality_status,
             stale_after, db_file_size_bytes, db_business_size_bytes, manifest_sha256,
             ingestion_run_id, quality_run_id, breadth_run_id, files_manifest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            package_id, "1.0.0", generated_at, str(latest_date) if latest_date else None,
            json.dumps(["SH", "SZ"]), sample_mode, round(coverage["observed"], 4), publishability,
            json.dumps(unavailable_metrics), data_quality_status,
            stale_after, db_sizes["db_file_size_bytes"], db_sizes["db_business_size_bytes"],
            manifest_sha256,
            last_run["run_id"] if last_run else None,
            quality_run["run_id"] if quality_run else None,
            breadth_run["run_id"] if breadth_run else None,
            json.dumps(manifest_content["files"])
        ])
        print(f"发布包记录已写入数据库: {package_id}")

    finally:
        conn.close()


if __name__ == '__main__':
    main()