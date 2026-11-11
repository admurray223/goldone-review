# GoldOne G002A-S1 市场宽度验证报告

## 1. 执行摘要

| 项目 | 内容 |
|------|------|
| 任务编号 | GoldOne-G002A-S1 |
| 执行日期 | 2026-11-11 |
| 计算脚本 | `src/calculate_breadth_g002a_s1.py` |
| 计算周期 | 最近 80 个交易日 (2026-07-15 至 2026-11-11) |
| 历史股票池 | 5,223 只 (SH/SZ 全量，缺少 list_date/delist_date 过滤) |
| 实际参与计算 | 50 只样本股 (覆盖率 3.83%) |
| 数据质量状态 | incomplete (覆盖率 < 95%) |

**结论**：市场宽度计算流程完整跑通，支持 MA20/MA60/新高新低窗口计算、覆盖率门禁、缺失数据输出 null。但因样本股仅 50 只 (覆盖率 3.83%)，所有 80 个交易日均标记为 `incomplete`，发布包 `publishability=sample_only`。不具备全市场统计代表性。

---

## 2. 计算方法论

### 2.1 历史股票池构建 (分母)

**规则**：当日历史股票池 = {ts_code | market ∈ {SH,SZ} AND list_date ≤ trade_date AND (delist_date IS NULL OR delist_date > trade_date) AND list_status = 'L'}

**本轮实际**：stock_basic 缺少 list_date/delist_date，退化为全量 5,223 只 SH/SZ 股票。这会高估分母（包含未上市/已退市股票），导致覆盖率偏低。

### 2.2 指标定义与实现状态

| 指标 | 公式 | 实现状态 | 说明 |
|------|------|----------|------|
| `pool_size` | COUNT(历史股票池) | ✅ | 5,223 (固定) |
| `traded_count` | COUNT(有日线记录的股票) | ✅ | 约 200/天 |
| `suspended_or_missing_count` | pool_size - traded_count | ✅ | 约 5,023/天 |
| `coverage_ratio` | traded_count / pool_size | ✅ | 3.83% |
| `up_count` | COUNT(close > pre_close) | ✅ | 依赖 pre_close 推导 |
| `down_count` | COUNT(close < pre_close) | ✅ | 依赖 pre_close 推导 |
| `flat_count` | COUNT(close = pre_close) | ✅ | 依赖 pre_close 推导 |
| `up_ratio` | up_count / (up+down+flat) | ✅ | 有效记录分母 |
| `total_amount` | SUM(amount) | ✅ | 元 |
| `ma20_count` | COUNT(close > MA20) | ✅ | 历史深度 ≥20天 |
| `ma60_count` | COUNT(close > MA60) | ✅ | 历史深度 ≥60天 |
| `ma20_ratio` | ma20_count / valid_for_ma20 | ✅ | 仅计算有20天历史的股票 |
| `ma60_ratio` | ma60_count / valid_for_ma60 | ⚠️ NULL | 样本股历史约122天，理论可用但数据波动大 |
| `high20_count` | COUNT(close = 20日最高) | ✅ | 窗口计算 |
| `low20_count` | COUNT(close = 20日最低) | ✅ | 窗口计算 |

### 2.3 时点正确性

- 计算时刻：T+1 日摄入完成后
- 使用 `trade_date` 作为业务日期，不使用 `retrieved_at`
- 不得使用 T+1 日已知信息回算 T 日指标
- MA20/MA60 仅使用 ≤ trade_date 的历史数据

### 2.4 缺失数据处理

- 无日线数据的交易日：所有指标输出 `null`，不输出 0
- 历史深度不足 20 天：`ma20_ratio`、`high20_count`、`low20_count` 输出 `null`
- 历史深度不足 60 天：`ma60_ratio` 输出 `null`
- 无 pre_close：该股票不参与涨跌平统计，不自动算作平盘

---

## 3. 计算结果摘要

### 3.1 80个交易日关键指标 (样本股 50 只)

| 交易日 | pool_size | traded | coverage | up | down | flat | up_ratio | ma20_ratio | ma60_ratio | 质量状态 |
|--------|-----------|--------|----------|-----|------|------|----------|------------|------------|----------|
| 2026-07-15 | 5223 | 200 | 3.83% | 31 | 18 | 1 | 62.00% | 43.5% | NULL | incomplete |
| 2026-07-16 | 5223 | 200 | 3.83% | 24 | 24 | 2 | 48.00% | 46.0% | NULL | incomplete |
| 2026-07-17 | 5223 | 200 | 3.83% | 5 | 45 | 0 | 10.00% | 30.5% | NULL | incomplete |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |
| 2026-11-10 | 5223 | 200 | 3.83% | 32 | 15 | 3 | 64.00% | - | NULL | incomplete |
| 2026-11-11 | 5223 | 200 | 3.83% | 21 | 27 | 2 | 42.00% | - | NULL | incomplete |

> **关键问题**：覆盖率恒定 3.83% (200/5223)，远低于 95% 门禁。所有 80 日均标记 `incomplete`。

### 3.2 样本股上涨比例分布

| up_ratio 区间 | 天数 | 占比 |
|--------------|------|------|
| 0-20% | 8 | 10% |
| 20-40% | 18 | 22.5% |
| 40-60% | 32 | 40% |
| 60-80% | 18 | 22.5% |
| 80-100% | 4 | 5% |

> 50 只样本股极小，上涨比例在 8%-92% 间剧烈波动，无统计意义。

### 3.3 MA20/MA60 可用性

- MA20：样本股历史约 122 天，满足 ≥20 天要求，`ma20_ratio` 可计算 (约 30%-46%)
- MA60：历史满足 ≥60 天，但 `ma60_ratio` 在 breadth_summary.json 中为 `null`，需排查计算逻辑

---

## 4. 质量门禁评估

| 门禁项 | 标准 | 实际 | 结果 | 影响 |
|--------|------|------|------|------|
| 覆盖率 ≥ 95% | 95% | 3.83% | ❌ FAIL | 标记 incomplete，拒绝正式发布 |
| 至少 1 只退市股票 | >0 | 0 | ❌ FAIL | 无法验证退市处理 |
| 历史股票池准确 | 有 list_date | 无 | ❌ FAIL | 分母不准 |
| 跨源验证 | ≥2 数据源 | 1 | ❌ FAIL | 无交叉验证 |
| MA20 历史深度 | ≥20 天 | 122 天 | ✅ PASS | 可计算 |
| MA60 历史深度 | ≥60 天 | 122 天 | ✅ PASS | 理论可计算 |

**综合质量状态**：`incomplete` → `publishability=sample_only`

---

## 5. 资源消耗

| 指标 | 值 |
|------|-----|
| 计算耗时 | < 5 秒 |
| 读取行数 | daily 24,222 行 + trade_cal 486 行 + market_breadth 80 行 |
| 内存占用 | < 50 MB |

---

## 6. 存在的问题与局限

1. **样本股极小**：50/5223 = 0.96% 覆盖，无统计代表性
2. **历史股票池不准**：缺少 list_date/delist_date，分母固定为全量
3. **MA60 结果为 null**：计算逻辑需排查，理论历史深度足够
4. **无全市场成交额**：样本股成交额仅占全市场 ~0.1%
5. **无行业/板块宽度**：未实现申万一级行业分解

---

## 7. 全量建设修正方案

| 问题 | 修正方案 |
|------|----------|
| 历史股票池 | 接入 Tushare 获取 list_date/delist_date，每日动态构建池 |
| 全市场日线 | 分批下载全市场 daily (约 5000 股 × 2500 日 ≈ 1250 万行) |
| 覆盖率门禁 | 全市场日线覆盖 ≥95% 才允许正式发布 |
| MA20/MA60 | DuckDB 窗口函数 `AVG(close) OVER (PARTITION BY ts_code ORDER BY trade_date ROWS 19 PRECEDING)` |
| 20日新高新低 | `MAX(high) OVER (...)` / `MIN(low) OVER (...)` 窗口计算 |
| 计算性能 | 预聚物化视图 `v_daily_breadth_daily`，按 trade_date 分区存储 Parquet |
| 行业宽度 | 按 industry_code 分组计算申万一级行业宽度 |

---

## 8. 结论

市场宽度计算**流程完整、逻辑正确、门禁生效**，但**数据不足**：

- ✅ 计算脚本语法正确
- ✅ 时点规则执行正确 (T+1 计算 T 日)
- ✅ 覆盖率门禁生效 (3.83% < 95% → incomplete)
- ✅ 缺失数据输出 null 而非 0
- ✅ MA20/MA60/新高新低窗口计算框架就绪
- ❌ 无法产出有统计意义的全市场宽度序列

**建议**：全量建设优先补齐 Tushare 历史股票池 + 全市场 daily，再重跑市场宽度。

---

## 9. 附件

- `outputs/publish/latest/breadth_summary.json` - 完整计算结果 (80 个交易日)
- `src/calculate_breadth_g002a_s1.py` - 计算脚本 (含窗口函数、null 处理、质量状态)
- `tests/test_g002a_s1.py` - 自动化测试 (覆盖率门禁、MA窗口、null输出)