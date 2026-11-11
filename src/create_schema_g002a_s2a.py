#!/usr/bin/env python3
"""
GoldOne G002A-S2A Schema 定义
增强版：支持事务/暂存表、pre_close 来源追踪、市场宽度、发布包、API 计数
S2A 修复：
- 明确事务边界
- 发布包 manifest 文件清单排除 manifest.json 自身
- 质量状态分开表示本次运行与历史累计
- 所有时间字段包含明确时区
"""
import duckdb
from pathlib import Path

TABLE_SQL = [
    # 1. ingestion_runs - 增强版，含时区信息
    """
    CREATE TABLE IF NOT EXISTS ingestion_runs (
        run_id           VARCHAR PRIMARY KEY,
        run_type         VARCHAR NOT NULL,
        target           VARCHAR NOT NULL,
        market_scope     VARCHAR NOT NULL DEFAULT '["SH","SZ"]',
        status           VARCHAR NOT NULL,
        started_at       TIMESTAMP WITH TIME ZONE NOT NULL,
        completed_at     TIMESTAMP WITH TIME ZONE,
        api_calls        INTEGER DEFAULT 0,
        rows_inserted    INTEGER DEFAULT 0,
        rows_updated     INTEGER DEFAULT 0,
        rows_skipped     INTEGER DEFAULT 0,
        error_message    VARCHAR,
        config_snapshot  VARCHAR,
        data_as_of       DATE
    )
    """,
    # 2. stock_basic - 增加 market_scope 校验
    """
    CREATE TABLE IF NOT EXISTS stock_basic (
        ts_code          VARCHAR PRIMARY KEY,
        thscode          VARCHAR,
        name             VARCHAR NOT NULL,
        industry         VARCHAR,
        industry_code    VARCHAR,
        area             VARCHAR,
        market           VARCHAR NOT NULL CHECK (market IN ('SH','SZ')),
        list_date        DATE,
        delist_date      DATE,
        list_status      VARCHAR NOT NULL CHECK (list_status IN ('L','D','P','U')),
        is_hs            BOOLEAN DEFAULT FALSE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        updated_at       TIMESTAMP WITH TIME ZONE NOT NULL
    )
    """,
    # 3. trade_cal
    """
    CREATE TABLE IF NOT EXISTS trade_cal (
        exchange         VARCHAR NOT NULL CHECK (exchange IN ('SH','SZ')),
        cal_date         DATE NOT NULL,
        is_open          BOOLEAN NOT NULL,
        pretrade_date    DATE,
        nexttrade_date   DATE,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        PRIMARY KEY (exchange, cal_date)
    )
    """,
    # 4. daily - 增加 pre_close_provenance
    """
    CREATE TABLE IF NOT EXISTS daily (
        ts_code               VARCHAR NOT NULL,
        trade_date            DATE NOT NULL,
        open                  DOUBLE,
        high                  DOUBLE,
        low                   DOUBLE,
        close                 DOUBLE,
        pre_close             DOUBLE,
        pre_close_provenance  VARCHAR CHECK (pre_close_provenance IN ('source','derived_previous_close','null_first_record')),
        change                DOUBLE,
        pct_chg               DOUBLE,
        volume                BIGINT,
        amount                DOUBLE,
        data_source           VARCHAR NOT NULL,
        retrieved_at          TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id      VARCHAR NOT NULL,
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
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
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
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
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
        retrieved_at         TIMESTAMP WITH TIME ZONE NOT NULL,
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
        retrieved_at       TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id   VARCHAR NOT NULL,
        PRIMARY KEY (ts_code, ex_date, action_type, source_record_id)
    )
    """,
    # 9. data_quality_issues - 增强严重级别
    """
    CREATE TABLE IF NOT EXISTS data_quality_issues (
        issue_id           VARCHAR PRIMARY KEY,
        table_name         VARCHAR NOT NULL,
        ts_code            VARCHAR,
        trade_date         DATE,
        issue_type         VARCHAR NOT NULL,
        severity           VARCHAR NOT NULL CHECK (severity IN ('critical','warning','info')),
        description        VARCHAR NOT NULL,
        expected_value     VARCHAR,
        actual_value       VARCHAR,
        detected_at        TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id   VARCHAR,
        quality_gate       VARCHAR CHECK (quality_gate IN ('passed','passed_with_warnings','incomplete','failed')),
        resolved           BOOLEAN DEFAULT FALSE,
        resolved_at        TIMESTAMP WITH TIME ZONE,
        resolution_note    VARCHAR
    )
    """,
    # 10. api_call_counter - 精确 API 计数
    """
    CREATE TABLE IF NOT EXISTS api_call_counter (
        counter_id         VARCHAR PRIMARY KEY,
        ingestion_run_id   VARCHAR NOT NULL,
        endpoint           VARCHAR NOT NULL,
        method             VARCHAR NOT NULL,
        params_hash        VARCHAR,
        success            BOOLEAN NOT NULL,
        retry_count        INTEGER DEFAULT 0,
        error_message      VARCHAR,
        started_at         TIMESTAMP WITH TIME ZONE NOT NULL,
        completed_at       TIMESTAMP WITH TIME ZONE,
        duration_ms        INTEGER
    )
    """,
    # 11. staging_daily - 暂存表用于事务性摄入
    """
    CREATE TABLE IF NOT EXISTS staging_daily (
        ts_code               VARCHAR NOT NULL,
        trade_date            DATE NOT NULL,
        open                  DOUBLE,
        high                  DOUBLE,
        low                   DOUBLE,
        close                 DOUBLE,
        pre_close             DOUBLE,
        pre_close_provenance  VARCHAR,
        change                DOUBLE,
        pct_chg               DOUBLE,
        volume                BIGINT,
        amount                DOUBLE,
        data_source           VARCHAR NOT NULL,
        retrieved_at          TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id      VARCHAR NOT NULL,
        batch_id              VARCHAR NOT NULL,
        validated             BOOLEAN DEFAULT FALSE,
        validation_errors     VARCHAR,
        PRIMARY KEY (ts_code, trade_date, data_source, batch_id)
    )
    """,
    # 12. staging_adj_factor
    """
    CREATE TABLE IF NOT EXISTS staging_adj_factor (
        ts_code          VARCHAR NOT NULL,
        trade_date       DATE NOT NULL,
        adj_factor       DOUBLE NOT NULL,
        data_source      VARCHAR NOT NULL,
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        batch_id         VARCHAR NOT NULL,
        validated        BOOLEAN DEFAULT FALSE,
        validation_errors VARCHAR,
        PRIMARY KEY (ts_code, trade_date, data_source, batch_id)
    )
    """,
    # 13. staging_stock_basic
    """
    CREATE TABLE IF NOT EXISTS staging_stock_basic (
        ts_code          VARCHAR NOT NULL,
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
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        batch_id         VARCHAR NOT NULL,
        validated        BOOLEAN DEFAULT FALSE,
        validation_errors VARCHAR,
        PRIMARY KEY (ts_code, batch_id)
    )
    """,
    # 13b. staging_index_daily
    """
    CREATE TABLE IF NOT EXISTS staging_index_daily (
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
        retrieved_at     TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id VARCHAR NOT NULL,
        batch_id         VARCHAR NOT NULL,
        validated        BOOLEAN DEFAULT FALSE,
        validation_errors VARCHAR,
        PRIMARY KEY (ts_code, trade_date, data_source, batch_id)
    )
    """,
    # 13c. staging_corporate_actions
    """
    CREATE TABLE IF NOT EXISTS staging_corporate_actions (
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
        retrieved_at       TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id   VARCHAR NOT NULL,
        batch_id           VARCHAR NOT NULL,
        validated          BOOLEAN DEFAULT FALSE,
        validation_errors  VARCHAR,
        PRIMARY KEY (ts_code, ex_date, action_type, source_record_id, batch_id)
    )
    """,
    # 14. market_breadth - 市场宽度计算结果 (S2A 修复：明确分离 observed/comparison_valid/unknown)
    """
    CREATE TABLE IF NOT EXISTS market_breadth (
        trade_date                   DATE NOT NULL,
        pool_size                    INTEGER NOT NULL,
        observed_count               INTEGER NOT NULL,
        comparison_valid_count       INTEGER NOT NULL,
        unknown_change_count         INTEGER NOT NULL,
        coverage_ratio_observed      DOUBLE NOT NULL,
        coverage_ratio_comparison    DOUBLE NOT NULL,
        up_count                     INTEGER NOT NULL,
        down_count                   INTEGER NOT NULL,
        flat_count                   INTEGER NOT NULL,
        up_ratio                     DOUBLE,
        total_amount                 DOUBLE,
        ma20_count                   INTEGER,
        ma60_count                   INTEGER,
        ma20_ratio                   DOUBLE,
        ma60_ratio                   DOUBLE,
        high20_count                 INTEGER,
        low20_count                  INTEGER,
        data_quality_status          VARCHAR NOT NULL CHECK (data_quality_status IN ('passed','passed_with_warnings','incomplete','failed')),
        unavailable_metrics          VARCHAR,
        calculated_at                TIMESTAMP WITH TIME ZONE NOT NULL,
        ingestion_run_id             VARCHAR NOT NULL,
        PRIMARY KEY (trade_date, ingestion_run_id)
    )
    """,
    # 15. publish_package - 发布包记录
    """
    CREATE TABLE IF NOT EXISTS publish_package (
        package_id           VARCHAR PRIMARY KEY,
        schema_version       VARCHAR NOT NULL,
        generated_at         TIMESTAMP WITH TIME ZONE NOT NULL,
        data_as_of           DATE NOT NULL,
        market_scope         VARCHAR NOT NULL,
        sample_mode          BOOLEAN NOT NULL,
        coverage_ratio       DOUBLE,
        publishability       VARCHAR NOT NULL CHECK (publishability IN ('full','partial','sample_only')),
        unavailable_metrics  VARCHAR,
        data_quality_status  VARCHAR NOT NULL CHECK (data_quality_status IN ('passed','passed_with_warnings','incomplete','failed')),
        stale_after          TIMESTAMP WITH TIME ZONE NOT NULL,
        db_file_size_bytes   BIGINT,
        db_business_size_bytes BIGINT,
        manifest_sha256      VARCHAR,
        ingestion_run_id     VARCHAR NOT NULL,
        quality_run_id       VARCHAR,
        breadth_run_id       VARCHAR,
        files_manifest       VARCHAR
    )
    """,
]

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_daily_ts_code ON daily(ts_code)",
    "CREATE INDEX IF NOT EXISTS idx_daily_trade_date ON daily(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_daily_ingestion_run ON daily(ingestion_run_id)",
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
    "CREATE INDEX IF NOT EXISTS idx_quality_issues_severity ON data_quality_issues(severity)",
    "CREATE INDEX IF NOT EXISTS idx_quality_issues_run ON data_quality_issues(ingestion_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started ON ingestion_runs(started_at)",
    "CREATE INDEX IF NOT EXISTS idx_ingestion_runs_type ON ingestion_runs(run_type)",
    "CREATE INDEX IF NOT EXISTS idx_api_calls_run ON api_call_counter(ingestion_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_api_calls_endpoint ON api_call_counter(endpoint)",
    "CREATE INDEX IF NOT EXISTS idx_staging_daily_batch ON staging_daily(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_staging_adj_factor_batch ON staging_adj_factor(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_staging_stock_basic_batch ON staging_stock_basic(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_staging_index_daily_batch ON staging_index_daily(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_staging_corporate_actions_batch ON staging_corporate_actions(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_market_breadth_date ON market_breadth(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_market_breadth_run ON market_breadth(ingestion_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_publish_package_generated ON publish_package(generated_at)",
]


def create_schema(db_path: str = "data/goldone_g002a_s2a.duckdb"):
    """创建 GoldOne G002A-S2A Schema"""
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
    db_path = sys.argv[1] if len(sys.argv) > 1 else "data/goldone_g002a_s2a.duckdb"
    create_schema(db_path)