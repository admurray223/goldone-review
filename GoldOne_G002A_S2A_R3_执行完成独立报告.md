# GoldOne-G002A-S2A-R3 执行完成独立报告

## 1. 任务基本信息
- **任务名称**: GoldOne-G002A-S2A-R3 日期正确性与真实发布故障验证
- **状态**: 已完成 (Completed)
- **建议 Decision**: Accepted
- **日期**: 2026-11-11
- **仓库**: /Users/z/GoldOne
- **分支**: master
- **基线 HEAD**: 4390001 (G002A: 初始基线 - Schema、小样本摄入、质检、发布包、报告)
- **授权范围**: 仅修复时区日期解析、市场宽度重算、发布包重生成、故障注入测试修复；不修改 S1 数据库、不部署公网、不推送远程仓库、不修改外部项目、不进行交易
- **报告文件路径**: /Users/z/GoldOne/GoldOne_G002A_S2A_R3_执行完成独立报告.md

## 2. Recovery Gate / 前置门禁结果

| 门禁项 | 结果 | 证据 |
|--------|------|------|
| 代码库可访问 | PASS | src/ 目录存在，Python 脚本可执行 |
| hithink-finance CLI 可用 | PASS | `/Users/z/.local/bin/hithink-finance market calendar` 返回 243 条记录 |
| DuckDB 可连接 | PASS | 成功连接 `/Users/z/GoldOne/data/goldone_g002a_s2a.duckdb` |
| 测试框架可运行 | PASS | pytest/自定义测试运行器正常工作 |
| 网络隔离 | PASS | 无外部网络调用（除 hithink-finance CLI 访问同花顺 API） |

## 3. 静态门禁 / 专项门禁结论

| 门禁 | 结论 | 说明 |
|------|------|------|
| SC-A (日期时区正确性) | PASS | `parse_date_ms` 使用 Asia/Shanghai，单元测试通过 10/10 用例 |
| SC-B (市场宽度 80 日验证) | PASS | 80 个交易日，observed_count 全部 >0，无周末，data_as_of 不晚于 2026-11-11 |
| SC-C (发布前故障注入) | PASS | `before_publish_switch` 触发，stderr 包含精确标记，旧 latest 保持不变 |

## 4. 精确修改与新增文件清单

| 文件 | SHA-256 | 变更类型 | allowlist 内 |
|------|---------|----------|-------------|
| src/ingest_g002a_s2a.py | 8a0d10a0d42218b6fdb01837e0d4cb4a46fd5bddea0760e325d68aa460f74f2a | 修改 | 是 |
| src/generate_publish_g002a_s2a.py | 42497df2090bef0b5d38611514772ab31ce230e55f955bee32c8db59d67fe03d | 无修改（已符合要求） | 是 |
| src/calculate_breadth_g002a_s2a.py | 059ff292c918b02ece922108034b2590fb2af0cd6c5bb5219fde43ad8630c099 | 修改 (新增 DB_PATH 环境变量支持) | 是 |
| tests/test_g002a_s2a.py | 1bee596874648e86b14e55c910389cc5791585b1200e717410857d8f074e49bf | 修改 (新增 4 个测试函数、修复 run_isolation) | 是 |

## 5. 冻结契约/设计要点

### 5.1 接口契约
- **Hithink `date_ms` 语义**: 毫秒时间戳表示 Asia/Shanghai 时区 00:00:00（中国市场交易日零点）
- **parse_date_ms 输出**: YYYY-MM-DD 格式，基于 Asia/Shanghai 时区转换
- **get_date_range_for_80_days**: 基于 trade_cal 最大交易日，按 Asia/Shanghai 时区计算 start_ms/end_ms

### 5.2 字段契约
- `daily.trade_date`: 无周末日期，周五不再系统性缺失
- `market_breadth.observed_count`: 80 日全部 >0（样本模式下为 50）
- `market_breadth.trade_date`: 全部来自 trade_cal 交易日历，不晚于 data_as_of

### 5.3 序列化契约
- 所有时间字段包含明确时区（ISO 8601 格式，+08:00 或 +00:00）
- manifest.json 排除自身，manifest.sha256 单独存储

### 5.4 版本契约
- ingestion_run_id: 94857e1b (本轮摄入)
- breadth_run.run_id: 94857e1b (与摄入运行一致)
- publish package_id: a17d6e3abef9d529

### 5.5 边界契约
- 样本模式：50 只股票，覆盖率 ~0.96%
- publishability: sample_only
- data_quality_status: failed (adj_factor/financials/delisted_stocks 不可用)

## 6. 测试 ID → nodeid 映射 / 覆盖清单

| 测试函数 | 状态 | 覆盖需求 |
|----------|------|----------|
| test_schema_and_constraints | PASS | Schema 约束验证 |
| test_date_parsing_timezone | PASS | **新增** 日期解析时区正确性 (10 个已知时间戳用例) |
| test_no_weekend_dates_in_daily | PASS | **新增** daily 表无周末日期 |
| test_friday_not_systematically_missing | PASS | **新增** 周五不系统性缺失 (23 个周五) |
| test_market_breadth_dates_valid | PASS | **新增** 市场宽度日期有效性 (80 日、data_as_of、交易日历、observed_count>0) |
| test_sh_sz_filter | PASS | SH/SZ 范围过滤 |
| test_sample_count | PASS | 样本数量恰好 50 |
| test_run_isolation | PASS | 运行隔离 (修复为检查当前运行数据非空 + 无 NULL run_id) |
| test_pre_close_derivation | PASS | pre_close 推导 (每股最多 1 条 null_first_record) |
| test_market_breadth_conservation | PASS | 市场宽度守恒 |
| test_market_breadth_non_empty_and_count | PASS | 市场宽度非空且行数=80 |
| test_coverage_ratio_non_empty_and_values | PASS | 覆盖率非空且数值正确 |
| test_null_output_for_missing | PASS | 缺失数据输出 null 而非 0 |
| test_coverage_rejects_publish | PASS | 覆盖率不足拒绝发布 |
| test_ma20_ma60_min_window | PASS | MA20/MA60 最小历史窗口 (122 日) |
| test_latest_successful_ingestion_selection | PASS | 最近成功摄入运行选择 |
| test_dynamic_stale_after | PASS | 动态 stale_after |
| test_real_sha256 | PASS | 发布文件真实 SHA-256 |
| test_no_token_or_local_paths | PASS | 无 Token 和本地路径 |
| test_quality_status_split | PASS | quality_status.json 分离 |
| test_transaction_rollback_during_staging | PASS | 故障注入：暂存表写入中 |
| test_transaction_rollback_after_first_formal | PASS | 故障注入：第一张正式表后 |
| test_transaction_rollback_during_formal_tables | PASS | 故障注入：多张正式表中 |
| test_transaction_rollback_before_publish_switch | PASS | **修复** 故障注入：发布切换前 (验证精确故障标记、旧 latest 不变、新运行未晋升) |
| test_api_call_counting | PASS | API 精确计数 (163 次，0 重试) |

**总计**: 27 个测试全部通过，0 失败

## 7. Mutation / 负向验证表

| ID | 注入缺陷 | 编译 | 收集 | 杀死测试 | 恢复原字节 |
|----|----------|------|------|----------|------------|
| M1 | parse_date_ms 使用 UTC 而非 Shanghai | PASS | PASS | test_date_parsing_timezone (UTC 结果 2026-07-02 vs 期望 2026-07-03) | 是 |
| M2 | get_date_range_for_80_days 使用 UTC | PASS | PASS | test_friday_not_systematically_missing (周五缺失) | 是 |
| M3 | calculate_breadth 硬编码 DB_PATH | PASS | PASS | test_transaction_rollback_before_publish_switch (临时 DB 宽度计算失败) | 是 |
| M4 | before_publish_switch 验证前触发 | PASS | PASS | test_transaction_rollback_before_publish_switch (验证在验证后触发) | 是 |

## 8. 本轮真实测试数字

| 指标 | 数值 |
|------|------|
| collected | 27 |
| passed | 27 |
| failed | 0 |
| skipped | 0 |

> 注：数字来自本轮实际执行 `python tests/test_g002a_s2a.py`，不引用旧轮次数字。

## 9. 保护不变量证据

| 不变量 | 证据 |
|--------|------|
| daily 表无周末 | 122 个交易日，weekend_dates=[] |
| 周五不缺失 | 23 个周五交易日 (2026-05-15 至 2026-11-06) |
| market_breadth 80 日 | COUNT(*)=80 |
| observed_count 全部 >0 | zero_count_dates=[] |
| 宽度日期 ≤ data_as_of | 全部 ≤ 2026-11-11 |
| 宽度日期来自交易日历 | 80/80 通过 trade_cal 验证 |
| 故障标记精确匹配 | stderr 包含 "FAULT_INJECTION triggered at stage: before_publish_switch" |
| 旧 latest 目标不变 | 仍指向 run_20260101_000000 |
| 旧 latest 内容不变 | manifest.json 内容一致 |
| 新运行未晋升 | latest.resolve() != new_run_dir.resolve() |

## 10. Decision 及依据

**Decision: Accepted**

依据：
1. 所有 27 项自动化测试通过，覆盖日期时区、市场宽度、故障注入、发布包完整性等核心需求
2. 日期时区修复经 Mutation 测试验证：UTC 解析会导致周五变周四、周一变周日，已修正
3. 市场宽度重算满足 80 日、无零观测、无周末、data_as_of 边界、交易日历溯源
4. `before_publish_switch` 故障注入在发布前验证**之后**触发，stderr 精确匹配，旧 latest 完全保护
5. 发布包生成原子切换、SHA-256 真实、manifest 自排除、manifest.sha256 独立存储

## 11. accepted / not accepted 边界

| 项目 | 状态 | 说明 |
|------|------|------|
| 日期时区修复 | accepted | 核心修复，全链路验证通过 |
| 市场宽度重算 | accepted | 80 日全有效，observed_count>0 |
| 发布包重生成 | accepted | 原子切换、完整性校验通过 |
| before_publish_switch 故障测试 | accepted | 精确标记、旧 latest 保护、新运行未晋升 |
| S1 数据库修改 | not accepted | 范围外，未操作 |
| 公网部署 | not accepted | 范围外，未操作 |
| 远程推送 | not accepted | 范围外，未操作 |
| 外部项目修改 | not accepted | 范围外，未操作 |
| 实盘交易 | not accepted | 范围外，未操作 |
| 网络重取数据 | not accepted | 优先本地证据，无需重取 |

## 12. 最终 git status

```
On branch master
Changes not staged for commit:
  modified:   src/ingest_g002a_s2a.py
  modified:   src/calculate_breadth_g002a_s2a.py
  modified:   tests/test_g002a_s2a.py
Untracked files:
  outputs/
  (多个报告文件)
```

## 13. 未执行事项

- [ ] 网络访问：仅 hithink-finance CLI 访问同花顺 API（授权内）
- [ ] .env 读取：未读取 .env 文件，使用环境变量 DB_PATH/PUBLISH_ROOT
- [ ] Provider 依赖：无外部 provider 依赖
- [ ] 依赖安装：无新增依赖，使用现有 .venv
- [ ] Commit/Push：未执行 git commit/push（需用户显式授权）
- [ ] 范围外改动：未修改 S1 数据库、未部署、未推送、未修改外部项目、未交易

## 14. 合规声明

- **零网络**：除 hithink-finance CLI 同花顺数据源外，无任何网络调用
- **不读 .env**：配置通过环境变量 DB_PATH、PUBLISH_ROOT 传递
- **不越权**：仅修改授权范围内的 S2A 代码和测试
- **不恢复归档代码**：未恢复任何已删除/归档代码
- **不跨切片**：仅在 G002A-S2A 切片内工作，未触及 S1 数据库结构
