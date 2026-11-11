# GoldOne G002A 架构与数据字典

## 1. 概述

本文档定义 GoldOne G002A 最小历史研究数据基础的数据库架构、表结构、字段含义、单位规范、主键/索引设计及派生查询规则。

数据库：DuckDB (单文件，`data/goldone.duckdb`)

设计原则：
- **原始数据与派生数据分离**：`daily` 仅存不复权原始行情；`adj_factor` 仅存数据源原始复权因子；前复权价格由视图/查询动态生成
- **全链路溯源**：每条记录保留 `data_source`、`retrieved_at`、`ingestion_run_id`
- **修订不覆盖**：财务修订通过 `report_version` + `source_record_id` + `revision_record_id` 共存
- **不可用不伪装**：`valuation.unavailable` 快照显式标记，不填充 NULL 伪装正常数据

---

## 2. 表清单 (9 表)

| 表名 | 类型 | 说明 |
|------|------|------|
| `ingestion_runs` | 元数据 | 数据摄入运行记录 |
| `stock_basic` | 基础 | 股票基础信息 (含上市/退市) |
| `trade_cal` | 基础 | 多交易所交易日历 |
| `daily` | 行情 | 不复权日线原始数据 |
| `adj_factor` | 行情 | 复权因子 (仅原始因子) |
| `index_daily` | 行情 | 指数日线行情 |
| `financials` | 财务 | 财务报表 (修订不覆盖) |
| `corporate_actions` | 公司行为 | 除权除息等事件 |
| `data_quality_issues` | 质量 | 数据质量问题记录 |

---

## 3. 表结构详解

### 3.1 ingestion_runs

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `run_id` | VARCHAR | PK | 摄入运行唯一标识 (UUID 短码) |
| `run_type` | VARCHAR | NOT NULL | `full` \| `incremental` \| `sample` \| `backfill` |
| `target` | VARCHAR | NOT NULL | 目标表/范围 |
| `status` | VARCHAR | NOT NULL | `running` \| `completed` \| `failed` \| `partial` |
| `started_at` | TIMESTAMP | NOT NULL | 开始时间 |
| `completed_at` | TIMESTAMP | | 完成时间 |
| `api_calls` | INTEGER | DEFAULT 0 | API 调用次数 |
| `rows_inserted` | INTEGER | DEFAULT 0 | 插入行数 |
| `rows_updated` | INTEGER | DEFAULT 0 | 更新行数 |
| `rows_skipped` | INTEGER | DEFAULT 0 | 跳过行数 |
| `error_message` | VARCHAR | | 失败错误信息 |
| `config_snapshot` | VARCHAR | | 关键参数 JSON 快照 |
| `data_as_of` | DATE | | 数据截止日期 |

---

### 3.2 stock_basic

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 同花顺代码 (如 `000001.SZ`) |
| `thscode` | VARCHAR | | 内部 thscode |
| `name` | VARCHAR | NOT NULL | 股票名称 |
| `industry` | VARCHAR | | 申万一级行业 |
| `industry_code` | VARCHAR | | 行业代码 |
| `area` | VARCHAR | | 地域 |
| `market` | VARCHAR | NOT NULL | `SSE` \| `SZSE` \| `BSE` |
| `list_date` | DATE | | 上市日期 |
| `delist_date` | DATE | | 退市日期 |
| `list_status` | VARCHAR | NOT NULL | `L` 上市 \| `D` 退市 \| `P` 暂停 \| `U` 未上市 |
| `is_hs` | BOOLEAN | DEFAULT FALSE | 沪深港通标的 |
| `data_source` | VARCHAR | NOT NULL | `tushare` \| `hithink` \| `manual` |
| `retrieved_at` | TIMESTAMP | NOT NULL | 实际拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联 ingestion_runs |
| `updated_at` | TIMESTAMP | NOT NULL | 本地更新时间 |

---

### 3.3 trade_cal

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `exchange` | VARCHAR | PK | `SSE` \| `SZSE` \| `BSE` |
| `cal_date` | DATE | PK | 日历日期 |
| `is_open` | BOOLEAN | NOT NULL | 是否交易日 |
| `pretrade_date` | DATE | | 前一交易日 |
| `nexttrade_date` | DATE | | 后一交易日 |
| `data_source` | VARCHAR | NOT NULL | 数据源 |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

---

### 3.4 daily (不复权日线，原始数据)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 股票代码 |
| `trade_date` | DATE | PK | 交易日期 |
| `open` | DOUBLE | | 开盘价 (元) |
| `high` | DOUBLE | | 最高价 (元) |
| `low` | DOUBLE | | 最低价 (元) |
| `close` | DOUBLE | | 收盘价 (元) |
| `pre_close` | DOUBLE | | 前收盘价 (元) |
| `change` | DOUBLE | | 涨跌额 (元) |
| `pct_chg` | DOUBLE | | 涨跌幅 (%) |
| `volume` | BIGINT | | **成交量 (股)** |
| `amount` | DOUBLE | | **成交额 (元)** |
| `data_source` | VARCHAR | PK | 数据源 (允许多源同日期共存) |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

> **单位约定**：`volume` 统一为 **股**，`amount` 统一为 **元**。原始接口若为“手”或“万元”，需在摄入层转换并记录于数据字典。

---

### 3.5 adj_factor (复权因子，仅存原始因子)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 股票代码 |
| `trade_date` | DATE | PK | 交易日期 |
| `adj_factor` | DOUBLE | NOT NULL | **数据源原始复权因子** |
| `data_source` | VARCHAR | PK | `tushare` \| `hithink` (允许多源共存) |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

> **不存储**：`base_date`、`base_factor`、`forward_adj_price` 等派生字段。前复权价格由查询/视图动态计算：
> ```sql
> -- 前复权收盘价 = close * (adj_factor / latest_adj_factor)
> SELECT d.ts_code, d.trade_date, d.close * (a.adj_factor / a_latest.adj_factor) AS close_qfq
> FROM daily d
> JOIN adj_factor a ON d.ts_code=a.ts_code AND d.trade_date=a.trade_date
> JOIN (SELECT ts_code, MAX(trade_date) AS max_date FROM adj_factor GROUP BY ts_code) am ON a.ts_code=am.ts_code
> JOIN adj_factor a_latest ON a_latest.ts_code=am.ts_code AND a_latest.trade_date=am.max_date
> WHERE d.data_source='hithink' AND a.data_source='hithink'
> ```

---

### 3.6 index_daily (指数日线)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 指数代码 (如 `000001.SH`) |
| `trade_date` | DATE | PK | 交易日期 |
| `open` | DOUBLE | | 开盘点位 |
| `high` | DOUBLE | | 最高点位 |
| `low` | DOUBLE | | 最低点位 |
| `close` | DOUBLE | | 收盘点位 |
| `pre_close` | DOUBLE | | 前收盘点位 |
| `change` | DOUBLE | | 涨跌点位 |
| `pct_chg` | DOUBLE | | 涨跌幅 (%) |
| `volume` | BIGINT | | 成交量 (股/手，见数据字典) |
| `amount` | DOUBLE | | 成交额 (元) |
| `data_source` | VARCHAR | PK | 数据源 |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

---

### 3.7 financials (财务报表，修订不覆盖)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 股票代码 |
| `ann_date` | DATE | | 公告日期 |
| `f_ann_date` | DATE | | 实际公告日期 |
| `end_date` | DATE | PK | 报告期结束日 |
| `report_type` | VARCHAR | PK | `annual` \| `quarterly` \| `semi_annual` |
| `comp_type` | VARCHAR | PK | `consolidated` \| `parent` |
| `report_version` | INTEGER | NOT NULL | 修订版本号 (1=首发，2+=修订) |
| `source_record_id` | VARCHAR | PK | 源记录唯一标识 |
| `revision_record_id` | VARCHAR | | 修订记录标识 |
| `metric` | VARCHAR | PK | 财务指标名 |
| `value` | DOUBLE | | 指标数值 |
| `unit` | VARCHAR | NOT NULL | `yuan` \| `yuan_10k` \| `share` 等 |
| `data_source` | VARCHAR | NOT NULL | 数据源 |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

> **修订共存规则**：同一 `ts_code` + `end_date` + `report_type` + `comp_type` + `metric` 可有多行，通过 `report_version` 区分，`source_record_id` 唯一标识每个源记录，`revision_record_id` 关联修订链。

---

### 3.8 corporate_actions (公司行为)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `ts_code` | VARCHAR | PK | 股票代码 |
| `ex_date` | DATE | PK | 除权除息日 |
| `record_date` | DATE | | 股权登记日 |
| `pay_date` | DATE | | 派息日/到账日 |
| `dividend_per_share` | DOUBLE | | 每股分红 (税前，元) |
| `bonus_ratio` | DOUBLE | | 送股比例 (每10股送X股) |
| `split_ratio` | DOUBLE | | 转增/拆股比例 (每10股转X股) |
| `action_type` | VARCHAR | PK | `dividend` \| `bonus` \| `split` \| `rights` \| `other` |
| `source_record_id` | VARCHAR | PK | 源记录唯一标识 |
| `data_source` | VARCHAR | NOT NULL | 数据源 |
| `retrieved_at` | TIMESTAMP | NOT NULL | 拉取时间 |
| `ingestion_run_id` | VARCHAR | NOT NULL | 关联运行 |

> 同一 `ts_code` + `ex_date` + `action_type` 允许多条记录 (不同 `source_record_id` / `data_source`)，不互相覆盖。

---

### 3.9 data_quality_issues (数据质量问题)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `issue_id` | VARCHAR | PK | 问题唯一标识 |
| `table_name` | VARCHAR | NOT NULL | 出问题的表名 |
| `ts_code` | VARCHAR | | 相关标的 |
| `trade_date` | DATE | | 相关日期 |
| `issue_type` | VARCHAR | NOT NULL | 见下文类型枚举 |
| `severity` | VARCHAR | NOT NULL | `critical` \| `warning` \| `info` |
| `description` | VARCHAR | NOT NULL | 问题描述 |
| `expected_value` | VARCHAR | | 期望值 |
| `actual_value` | VARCHAR | | 实际值 |
| `detected_at` | TIMESTAMP | NOT NULL | 检测时间 |
| `ingestion_run_id` | VARCHAR | | 关联摄入运行 |
| `resolved` | BOOLEAN | DEFAULT FALSE | 是否已解决 |
| `resolved_at` | TIMESTAMP | | 解决时间 |
| `resolution_note` | VARCHAR | | 解决备注 |

**issue_type 枚举**：
- `pk_duplicate` - 主键重复
- `missing_trade_date` - 交易日缺失
- `ohlc_violation` - OHLC 逻辑违规
- `negative_price` - 负价格
- `negative_volume` - 负成交量
- `negative_amount` - 负成交额
- `pre_post_listing` - 上市前/退市后异常
- `adj_factor_jump` - 复权因子突变
- `price_adj_inconsistent` - 原始/复权价格不一致
- `suspended_handling` - 停牌处理
- `multi_source_diff` - 多源差异
- `idempotency_violation` - 幂等性违规
- `other` - 其他

---

## 4. 索引设计

```sql
-- daily
CREATE INDEX idx_daily_ts_code ON daily(ts_code);
CREATE INDEX idx_daily_trade_date ON daily(trade_date);

-- adj_factor
CREATE INDEX idx_adj_factor_ts_code ON adj_factor(ts_code);
CREATE INDEX idx_adj_factor_trade_date ON adj_factor(trade_date);

-- index_daily
CREATE INDEX idx_index_daily_ts_code ON index_daily(ts_code);
CREATE INDEX idx_index_daily_trade_date ON index_daily(trade_date);

-- financials
CREATE INDEX idx_financials_ts_code ON financials(ts_code);
CREATE INDEX idx_financials_end_date ON financials(end_date);

-- corporate_actions
CREATE INDEX idx_corporate_actions_ts_code ON corporate_actions(ts_code);
CREATE INDEX idx_corporate_actions_ex_date ON corporate_actions(ex_date);

-- data_quality_issues
CREATE INDEX idx_quality_issues_table ON data_quality_issues(table_name);
CREATE INDEX idx_quality_issues_ts_code ON data_quality_issues(ts_code);
CREATE INDEX idx_quality_issues_date ON data_quality_issues(trade_date);

-- ingestion_runs
CREATE INDEX idx_ingestion_runs_started ON ingestion_runs(started_at);
```

---

## 5. 派生视图规范 (不物化存储)

| 视图名 | 说明 |
|--------|------|
| `v_daily_qfq` | 前复权日线 (动态计算) |
| `v_daily_hfq` | 后复权日线 (动态计算) |
| `v_latest_adj_factor` | 每只股票最新复权因子 |
| `v_stock_pool` | 当日历史股票池 (list_date <= trade_date < delist_date) |

> 视图定义在 `src/create_views.sql` 中，不作为物理表存储。

---

## 6. 数据字典：原始单位与转换规则

| 源字段 | 原始单位 | 目标单位 | 转换规则 | 记录位置 |
|--------|----------|----------|----------|----------|
| volume | 手 (100股) | 股 | `volume_shares = volume_lots * 100` | 摄入代码注释 |
| amount | 万元 | 元 | `amount_yuan = amount_wan * 10000` | 摄入代码注释 |
| adj_factor (tushare) | 以最新收盘价为基准 | 同 | 无转换，直接存储 | 数据字典 |
| adj_factor (hithink) | 以最新收盘价为基准 | 同 | 无转换，直接存储 | 数据字典 |

---

## 7. 历史时点字段规范

每条业务记录均保留：

| 字段 | 含义 | 示例 |
|------|------|------|
| `trade_date` | 业务日期 (T日) | `2024-01-02` |
| `provider_published_at` | 数据源发布时间 (若有) | `2024-01-03 06:00:00` |
| `retrieved_at` | 本地实际拉取时间 | `2026-11-10 10:00:00` |
| `available_from` | 可用于交易决策的最早时刻 (T+1 开盘前) | `2024-01-03 09:15:00` |
| `data_as_of` | 数据截止日期 (批次水印) | `2024-01-02` |

**规则**：
- Tushare 次日更新的数据，`available_from` = 下一交易日 09:15
- 只有日期无时间的财报，`available_from` = 下一交易日
- 日线数据不得用于模拟盘中已知信息
- 最新复权因子不得回填为当时已知

---

## 8. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-11-11 | G002A 初始版本，9 表 Schema 定义 |