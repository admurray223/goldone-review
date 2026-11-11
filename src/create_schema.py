#!/usr/bin/env python3
"""
GoldOne G002A Schema 定义
创建 9 张核心表，符合架构与数据字典要求
"""
import duckdb
from pathlib import Path

TABLE_SQL = [
    # 1. ingestion_runs
    """
    CREATE TABLE IF NOT EXISTS ingestion_runs (
        run_id           VARCHAR PRIMARY KEY,
        run_type         VARCHAR NOT NULL,
        target           VARCHAR NOT NULL,
        status           VARCHAR NOT NULL,
        started_at       TIMESTAMP NOT NULL,
        completed_at     TIMESTAMP,
        api_calls        INTEGER DEFAULT 0,
        rows_inserted    INTEGER DEFAULT 0,
        rows_updated     INTEGER DEFAULT 0,
        rows_skipped     INTEGER DEFAULT 0,
        error_message    VARCHAR,
        config_snapshot  VARCHAR,
        data_as_of       DATE
    )
    """,
    # 2. stock_basic
    """
    CREATE TABLE IF NOT EXISTS stock_basic (
        ts_code          VARCHAR PRIMARY KEY,
        thscode          VARCHAR,
        name             VARCHAR NOT NULL,
        industry         VARCHAR,
        industry_code    VARCHAR,
        area             VARCHAR,
        market           VARCHAR NOT NULL,
        list_date        DATE,
        delist_date      DATE,
        list_status      VARCHAR NOT NULL,
        is_hs            BOOLEAN DEFAULT FALSE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        updated_at       TIMESTAMP NOT NULL
    )
    """,
    # 3. trade_cal
    """
    CREATE TABLE IF NOT EXISTS trade_cal (
        exchange         VARCHAR NOT NULL,
        cal_date         DATE NOT NULL,
        is_open          BOOLEAN NOT NULL,
        pretrade_date    DATE,
        nexttrade_date   DATE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        PRIMARY KEY (exchange, cal_date)
    )
    """,
    # 4. daily
    """
    CREATE TABLE IF NOT EXISTS daily (
        ts_code          VARCHAR NOT NULL,
        trade_date       DATE NOT NULL,
        open             DOUBLE,
        high             DOUBLE,
        low              DOUBLE,
        close            DOUBLE,
        pre_close        DOUBLE,
        change           DOUBLE,
        pct_chg          DOUBLE,
        volume           BIGINT,
        amount           DOUBLE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, trade_date, data_source)
    )
    """,
    # 5. adj_factor
    """
    CREATE TABLE IF NOT EXISTS adj_factor (
        ts_code          VARCHAR NOT NULL,
        trade_date       DATE NOT NULL,
        adj_factor       DOUBLE NOT NULL,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, trade_date, data_source)
    )
    """,
    # 6. index_daily
    """
    CREATE TABLE IF NOT EXISTS index_daily (
        ts_code          VARCHAR NOT NULL,
        trade_date       DATE NOT NULL,
        open             DOUBLE,
        high             DOUBLE,
        low              DOUBLE,
        close            DOUBLE,
        pre_close        DOUBLE,
        change           DOUBLE,
        pct_chg          DOUBLE,
        volume           BIGINT,
        amount           DOUBLE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, trade_date, data_source)
    )
    """,
    # 7. financials
    """
    CREATE TABLE IF NOT EXISTS financials (
        ts_code              VARCHAR NOT NULL,
        ann_date             DATE,
        f_ann_date           DATE,
        end_date             DATE NOT NULL,
        report_type          VARCHAR NOT NULL,
        comp_type            VARCHAR NOT NULL,
        report_version       INTEGER NOT NULL,
        source_record_id     VARCHAR NOT NULL,
        revision_record_id   VARCHAR,
        metric               VARCHAR NOT NULL,
        value                DOUBLE,
        unit                 VARCHAR NOT NULL,
        data_source          VARCHAR NOT NULL,
        retrieved_at         TIMESTAMP NOT NULL,
        ingestion_run_id     VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, end_date, report_type, comp_type, metric, source_record_id)
    )
    """,
    # 8. corporate_actions
    """
    CREATE TABLE IF NOT EXISTS corporate_actions (
        ts_code            VARCHAR NOT NULL,
        ex_date            DATE NOT NULL,
        record_date        DATE,
        pay_date           DATE,
        dividend_per_share DOUBLE,
        bonus_ratio        DOUBLE,
        split_ratio        DOUBLE,
        action_type        VARCHAR NOT NULL,
        source_record_id   VARCHAR NOT NULL,
        data_source        VARCHAR NOT NULL,
        retrieved_at       TIMESTAMP NOT NULL,
        ingestion_run_id   VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, ex_date, action_type, source_record_id)
    )
    """,
    # 9. data_quality_issues
    """
    CREATE TABLE IF NOT EXISTS data_quality_issues (
        issue_id           VARCHAR PRIMARY KEY,
        table_name         VARCHAR NOT NULL,
        ts_code            VARCHAR,
        trade_date         DATE,
        issue_type         VARCHAR NOT NULL,
        severity           VARCHAR NOT NULL,
        description        VARCHAR NOT NULL,
        expected_value     VARCHAR,
        actual_value       VARCHAR,
        detected_at        TIMESTAMP NOT NULL,
        ingestion_run_id   VARCHAR,
        resolved           BOOLEAN DEFAULT FALSE,
        resolved_at        TIMESTAMP,
        resolution_note    VARCHAR
    )
    """,
]

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_daily_ts_code ON daily(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_daily_trade_date ON daily(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_adj_factor_ts_code ON adj_factor(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_adj_factor_trade_date ON adj_factor(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_index_daily_ts_code ON index_daily(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_index_daily_trade_date ON index_daily(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_financials_ts_code ON financials(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_financials_end_date ON financials(end_date)",
    "CREATE INDEX IF NOT EXISTS idx_corporate_actions_ts_code ON corporate_actions(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_corporate_actions_ex_date ON corporate_actions(ex_date)",
    "CREATE INDEX IF NOT EXISTS idx_quality_issues_table ON data_quality_issues(table_name)",
    "CREATE INDEX IF NOT EXISTS idx_quality_issues_ts_code ON data_quality_issues(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_quality_issues_date ON data_quality_issues(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started ON ingestion_runs(started_at)",
]


def create_schema(db_path: str = "data/goldone.duckdb"):
    """创建 GoldOne Schema"""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(db_path)
    try:
        for stmt in TABLE_SQL:
            conn.execute(stmt.strip())
        for stmt in INDEX_SQL:
            conn.execute(stmt.strip())
        print(f"Schema created successfully at {db_path}")
        
        tables = conn.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """).fetchall()
        print(f"Created tables ({len(tables)}):")
        for t in tables:
            print(f"  - {t[0]}")
    finally:
        conn.close()


if __name__ == '__main__':
    import sys
    db_path = sys.argv[1] if len(sys.argv) > 1 else "data/goldone.duckdb"
    create_schema(db_path)