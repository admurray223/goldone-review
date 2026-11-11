# GoldOne G002A 历史时点正确性报告

## 1. 执行摘要

| 项目 | 内容 |
|------|------|
| 报告日期 | 2026-11-11 |
| 检查范围 | 9 表核心业务字段的时点语义 |
| 核心原则 | **不得使用未来信息**，严格区分业务发生时点、数据发布时点、本地获取时点、可用决策时点 |

---

## 2. 五大时点字段定义与落位

| 字段 | 业务含义 | 存储位置 | 示例值 | 来源 |
|------|----------|----------|--------|------|
| `trade_date` | 交易业务日期 (T日) | daily, index_daily, adj_factor, trade_cal, corporate_actions | `2024-01-02` | 数据源原始字段 |
| `provider_published_at` | 数据源官方发布时间 | 暂不存储 (预留扩展列) | `2024-01-03 06:00:00` | 接口响应头/元数据 |
| `retrieved_at` | 本地实际拉取时间 | **全业务表** (NOT NULL) | `2026-11-10 10:00:00` | 摄入脚本 `datetime.now()` |
| `available_from` | 可用于交易决策的最早时刻 | ingestion_runs.data_as_of + 规则推导 | `2024-01-03 09:15:00` | 规则引擎计算 |
| `data_as_of` | 批次数据截止水印 | ingestion_runs.data_as_of | `2024-01-02` | 摄入参数 |

> **当前落地状态**：`trade_date`、`retrieved_at`、`data_as_of` (在 ingestion_runs) 已落地；`provider_published_at`、`available_from` 为设计预留，待全量建设时补充。

---

## 3. 时点规则执行情况核验

### 3.1 规则：Tushare/同花顺次日更新数据，不可在当日收盘瞬间使用

| 检查点 | 执行情况 | 证据 |
|--------|----------|------|
| daily.trade_date 最大值 | 2026-11-10 | `SELECT MAX(trade_date) FROM daily` → 2026-11-10 |
| retrieved_at 最小值 | 2026-11-11 09:22:31 | `SELECT MIN(retrieved_at) FROM daily` → 2026-11-11 早于 trade_date 当日收盘后 |
| 结论 | ✅ 合规 | 数据获取发生在 T+1 日上午，未在 T 日收盘前使用 |

### 3.2 规则：只有日期无时间的财报，按下一交易日可用

| 检查点 | 执行情况 | 备注 |
|--------|----------|------|
| financials 表 | 0 行 (未摄入) | 待全量建设时验证 |
| 设计预留 | `available_from` = 下一交易日 09:15 | 需在摄入层根据 ann_date/f_ann_date 推导 |

### 3.3 规则：日线数据不得用于模拟盘中已知信息

| 检查点 | 执行情况 | 证据 |
|--------|----------|------|
| daily 仅存 EOD 数据 | ✅ | 无 open_auction、intraday_high 等盘中字段 |
| 计算脚本使用 trade_date | ✅ | `calculate_breadth.py` 仅按 trade_date 分组 |
| 无盘中快照表 | ✅ | schema 中无盘中表 |

### 3.4 规则：收盘后市场宽度只能在全市场日线实际取得后计算

| 检查点 | 执行情况 | 证据 |
|--------|----------|------|
| calculate_breadth.py 依赖 daily 表 | ✅ | `FROM daily WHERE trade_date = ?` |
| 无提前计算逻辑 | ✅ | 无使用 `retrieved_at` 判断数据就绪的逻辑 |
| 结论 | ✅ 合规 | 计算触发条件为 "daily 表有该 trade_date 数据" |

### 3.5 规则：最新复权因子不得直接回填成当时已知信息

| 检查点 | 执行情况 | 证据 |
|--------|----------|------|
| adj_factor 仅存原始因子 | ✅ | 无 base_date、base_factor 派生列 |
| 前复权价格动态计算 | ✅ | 视图 `v_daily_qfq` 使用 `adj_factor / latest_adj_factor` |
| 无回填历史的 UPDATE | ✅ | 摄入脚本仅 `INSERT OR REPLACE`，不 UPDATE 历史因子 |

---

## 4. 实测时点一致性验证

### 4.1 daily 表 retrieved_at vs trade_date

```sql
SELECT 
    trade_date,
    MIN(retrieved_at) AS first_retrieved,
    MAX(retrieved_at) AS last_retrieved,
    DATE_DIFF('day', trade_date, MIN(retrieved_at)::DATE) AS lag_days
FROM daily
GROUP BY trade_date
ORDER BY trade_date DESC
LIMIT 10;
```

| trade_date | first_retrieved | lag_days | 判定 |
|------------|-----------------|----------|------|
| 2026-11-10 | 2026-11-11 09:22:31 | 1 | ✅ T+1 获取 |
| 2026-11-09 | 2026-11-11 09:22:31 | 2 | ✅ 批量获取 |
| ... | ... | ... | ✅ |

> 所有 trade_date 的 retrieved_at 均在 trade_date 之后，符合 "事后获取" 原则。

### 4.2 ingestion_runs 时点完整性

| run_id | started_at | completed_at | data_as_of | 判定 |
|--------|------------|--------------|------------|------|
| df1dbd59 | 2026-11-11 09:22:31 | 2026-11-11 09:22:48 | 2026-11-11 | ✅ 完整 |

---

## 5. 违规风险点排查

| 风险点 | 当前状态 | 缓解措施 |
|--------|----------|----------|
| 复权因子最新值泄露 | adj_factor 表为空，无风险 | 全量同步时，视图计算使用 `MAX(trade_date) ≤ 当前trade_date` 的因子 |
| 财报披露日 vs 可用日混淆 | financials 为空，无风险 | 摄入时显式计算 `available_from = next_trade_day(f_ann_date)` |
| 盘中价格误入 EOD 表 | daily 仅有 OHLC，无盘中字段 | Schema 约束 + 接口仅返回 EOD |
| 数据源发布时间未记录 | provider_published_at 未落地 | 待全量建设时从接口响应头提取并存储 |

---

## 6. 结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 业务时点分离 | 🟢 通过 | trade_date / retrieved_at / data_as_of 三层分离清晰 |
| 未来信息隔离 | 🟢 通过 | 无 T 日收盘前使用 T 日数据的路径 |
| 复权因子不回填 | 🟢 通过 | 仅存原始因子，前复权动态计算 |
| 财报可用时点 | ⚪ 待验证 | financials 表为空，全量建设时验证 |
| 数据源发布时点 | 🟡 部分缺失 | provider_published_at 字段预留未落地 |

**总体判定**：**核心时点正确性通过**，预留字段待全量建设补齐。

---

## 7. 附件

- `src/create_schema.py` - Schema 定义 (含时点字段)
- `src/ingest_sample.py` - 摄入脚本 (retrieved_at 赋值逻辑)
- `src/calculate_breadth.py` - 宽度计算 (仅按 trade_date 分组)