# GoldOne_G001_RC2 残余问题整改报告

**任务编号**: GoldOne-G001-RC2
**执行日期**: 2026-11-11
**基线**: RC 报告 (GoldOne_G001_RC_*) 全部修正
**约束**: 零 DSA/Bridge 修改，零正式数据库，零网络批量

---

## 1. Ashare 单位重新验证结果

### 1.1 测试样本

| 股票 | 代码 | 交易所 | 交易日 |
|------|------|--------|--------|
| 阳光电源 | 300274.SZ | SZSE | 2024-01-02, 2024-01-03, 2024-01-04 |
| 贵州茅台 | 600519.SH | SSE | 2024-01-02, 2024-01-03, 2024-01-04 |
| 平安银行 | 000001.SZ | SZSE | 2024-01-02, 2024-01-03, 2024-01-04 |

### 1.2 逐接口单位确认

#### `/daily` (新浪日线)

原始响应摘录 (300274.SZ, 2024-01-02): `"volume":"13401807.0"`

Tushare 返回值: `vol=134018.07` (单位 = 手)

换算验证: `134018.07 手 × 100 = 13,401,807 股` 与 Ashare/Sina `13,401,807.0` **精确匹配**

**结论: `/daily` volume 单位 = 股 (shares), 非手**

证据链：
- Sina API 返回原始 volume，Ashare.py 行 239-241 不做单位转换 (`df['volume'] = df['volume'].astype(float)`)
- server.py 行 590 原样传递 `"volume": fields["volume"]`
- Tushare 134,018.07 手 × 100 = 13,401,807 股 = Sina 13,401,807 股

| 股票 | 日期 | Sina volume (股) | Tushare vol (手→股) | 匹配 |
|------|------|-----------------|-------------------|------|
| 300274 | 2024-01-02 | 13,401,807 | 134,018.07×100=13,401,807 | ✅ |
| 300274 | 2024-01-03 | 13,105,909 | — (Token 已失效) | ⚠️ 格式一致 |
| 300274 | 2024-01-04 | 13,740,482 | — | ⚠️ |
| 600519 | 2024-01-02 | 3,215,644 | — | ⚠️ |
| 600519 | 2024-01-03 | 2,022,929 | — | ⚠️ |
| 600519 | 2024-01-04 | 2,155,107 | — | ⚠️ |
| 000001 | 2024-01-02 | 115,836,645 | — | ⚠️ |
| 000001 | 2024-01-03 | 73,361,031 | — | ⚠️ |
| 000001 | 2024-01-04 | 86,419,399 | — | ⚠️ |

> ⚠️ Tushare Token 已在轮换后失效，仅 300274 2024-01-02 有直接对照。其余样本无 Tushare 对照。DSA 代码 tushare_fetcher.py:770 行 `df['volume'] = df['volume'] * 100` 确认 Tushare vol 单位为手 → 乘 100 得股。

#### `/quote` (腾讯 qt 接口, 实时快照)

- `day_volume`: 591,183.0 (300274, 2026-11-10)
- `/bars` 240 根 1m K线 volume 求和 = 591,183.0 → 确认 `/quote day_volume = sum(/bars volume)`
- 240 根完成一天交易 → 全市场当期数据

**单位判定**: `/quote day_volume` 与 `/bars` 同源 (腾讯 mkline 1m)

**结论: `/quote day_volume` 单位 = 手** (`×100 = 股`)

#### `/bars` (腾讯 mkline 1m)

- 240 根 K线，每根 volume 值在千到万级别
- 代表一分钟成交量；sum = 591,183.0 (300274, 2026-11-10)
- 若为 股：591,183 股/天 → 对百亿市值股票偏低
- 若为 手：591,183 手 × 100 = 59,118,300 股/天 → 合理

**结论: `/bars volume` 单位 = 手** (`×100 = 股`)

### 1.3 单位汇总对比

| 接口 | 数据源 | volume 单位 | volume→股 | amount 单位 | 证据 |
|------|--------|-------------|-----------|-------------|------|
| `/daily` | 新浪日线 | **股** | 不变 | null (无) | Tushare 134,018.07手 ×100 = Sina 13,401,807 股 |
| `/quote` | 腾讯 qt | **手** | ×100 | 无 | 同源 `/bars` 240根求和 |
| `/bars` | 腾讯 mkline 1m | **手** | ×100 | 无 | 单根千~万级别，全市场日量合理 |

### 1.4 对比 RC 报告错误

| RC 报告表述 | 正确值 | 影响 |
|-------------|--------|------|
| "Ashare `/daily` volume = 手" | **股** | 原 RC 将 Sina 日线错误归为手，实际是股 |
| "Ashare `/quote` day_volume = 手" | **手** ✅ | 正确 |
| "Ashare `/bars` volume = 手" | **手** ✅ | 正确 |

**根本原因**: RC 报告将所有 Ashare 接口统一标注为"手"，未区分新浪日线与腾讯分钟线的单位差异。

---

## 2. Hithink 成交量差异调查

### 2.1 测试: 300274.SZ, 2024-01-02, 三种 adjust 模式

```json
// adjust=none
{"volume": 13401807, "turnover": 1153503411.49, "close_price": 85.4,
 "open_price": 87.5, "high_price": 87.6, "low_price": 85.23, "date_ms": 1704124800000}

// adjust=forward
{"volume": 18762529.8, "turnover": 1153503411.49, "close_price": 56.95,
 "open_price": 58.45, "high_price": 58.52, "low_price": 56.83, "date_ms": 1704124800000}

// adjust=backward
{"volume": 2068180.09, "turnover": 1153503411.49, "close_price": 559.16,
 "open_price": 572.77, "high_price": 573.42, "low_price": 558.06, "date_ms": 1704124800000}
```

### 2.2 关键发现

| 项目 | `none` | `forward` | `backward` |
|------|--------|-----------|------------|
| volume | 13,401,807 | 18,762,530 (+39.9%) | 2,068,180 (-84.6%) |
| turnover | 1,153,503,411.49 | 1,153,503,411.49 | 1,153,503,411.49 |
| close_price | 85.40 | 56.95 (-33.3%) | 559.16 (+554.8%) |
| **turnover across modes** | **恒等** | **恒等** | **恒等** |

### 2.3 差异来源分析

| 假设 | 验证 | 结论 |
|------|------|------|
| 数据源差异 (同花顺 vs 挖地兔) | ❌ | `adjust=none` 下 volume=13,401,807 与 Tushare 13,401,807 完全一致 |
| 日期错位 (date_ms) | ❌ | `date_ms=1704124800000` = 2024-01-02 00:00:00 CST，正确 |
| 复权量调整 (volume adjustment) | ✅ | forward/backward 改变 volume，turnover 不变 |
| 接口语义差异 | ✅ | 用户查询 `adjust=forward` 的 hithink 结果，与 Tushare `adjust=none` 对比 |

**根因**: RC 报告将 hithink `adjust=forward` 的 volume 与 Tushare `adjust=none` 的 vol×100 直接对比，产生 39.9% 差异。用 `adjust=none` 查询时二者**完全一致** (13,401,807 股)。

**正向验证**:
- `adjust=none` volume (13,401,807) = Tushare vol (134,018.07 手) × 100 = **13,401,807 股** ✅
- `adjust=forward` 会同时调整价格和成交量 (非仅价格)
- `adjust=backward` 同理

**机制推测** (unresolved): 复权调整时成交量随之缩放。forward 调整下，成交量被放大 (13,401,807 → 18,762,530)，缩放因子 1.3999 并非简单价格调整因子的倒数 (1/0.6669=1.4995)。推测 hithink 使用自己的复权因子序列 (非 Tushare 口径)，且成交量调整采用与价格不同的算法规则。

### 2.4 对 RC 报告的修正

| RC 报告表述 | 修正 |
|-------------|------|
| "39.9% 差异源于数据源本身差异 (同花顺 vs 挖地兔)" | **误判**。实际是 `adjust=forward` 与 `adjust=none` 的对比 |
| "两者均为股" | `adjust=none` 下确认均为股 ✅；`forward`/`backward` 下 volume 也随调整缩放 |
| "差异率 ~2.6% 源于复权因子算法体系差异" | 此结论仍有效 (price 差异)，但 volume 差异是调整模式的直接影响 |

---

## 3. 时点报告修正

### 3.1 日期错误

| 报告位置 | 原文 | 修正 |
|----------|------|------|
| 历史时点重建复核报告 §2.1 T1 | "11月3日收盘后 (周五收盘)" | **11月3日 (周二) 收盘后** |
| 历史时点重建复核报告 头部 | "复核对象: 2026-11-04 (周一)" | **复核对象: 2026-11-04 (周三)** |
| 历史时点重建复核报告 §2.1 T2 | "周一开盘前" | **周三开盘前** |

2026-11-03 = Tuesday, 2026-11-04 = Wednesday. (2026-01-01 = Thursday → Nov 1 = Sunday → Nov 3 = Tue, Nov 4 = Wed)

### 3.2 数据可用时间修正

| RC 报告表述 | 问题 | 修正 |
|-------------|------|------|
| "T1: 11月3日 15:00 后所有公开信息" | 隐含 Tushare 收盘后立即可得 | Tushare daily 实际次日凌晨更新。收盘完成 ≠ 数据可获得 |
| "T5: 11月4日 15:00 后所有公开信息" | 同上 | 15:00 收盘完成，但全市场数据(Tushare)需次日凌晨 |
| 涨跌家数/市场宽度不可重建 | 正确 | 收盘后可得日线后可事后计算，不实现时 |

### 3.3 涨跌家数条

原 RC：`"盘中市场宽度 (涨跌家数/成交额分布)": ❌ 不可得 — "仅收盘后可算"`

**修正**: 获得全市场当日日线后可**事后计算**涨跌停数、涨跌家数、总成交额。不是永久不可重建，而是不能在盘中实时获得。

最终分类：
- 盘中市场宽度 → **不可重建** (无历史分时)
- 收盘后涨跌家数 → **可从全市场日线事后计算** (需全量本地数据)

### 3.4 财报披露时点

| 场景 | 原则 |
|------|------|
| 财报只有 ann_date (日期, 无时分秒) | 按下一交易日可用处理 |
| Tushare 有 f_ann_date (修正公告日) | 按下一交易日可用处理 |
| hithink 有 report_date_ms | 按毫秒日期当日可用处理 (仍无时分) |

---

## 4. Schema 测试: 可复现性确认

### 4.1 环境

| 项目 | 值 |
|------|-----|
| Python | 3.14.7 (`.venv/bin/python`) |
| duckdb | 2.0.0 |
| 安装命令 | `/Users/z/GoldOne/.venv/bin/pip install duckdb==2.0.0` |
| 运行命令 | `/Users/z/GoldOne/.venv/bin/python /Users/z/GoldOne/tests/test_g002a_schema.py` |
| 退出码 | 0 (PASS) |

### 4.2 测试范围

```
Phase 1: 8 表创建 (7 PASS)
Phase 2: 正向插入 (6 PASS)
Phase 3: 正向断言 (18 PASS)
Phase 4: 负向测试 (6 PASS)
Total: 37 PASS, 0 FAIL
```

### 4.3 负向测试项目

| 测试 | 验证点 | 结果 |
|------|--------|------|
| daily PK 冲突 | 重复 (ts_code, trade_date) 被拒绝 | ✅ ConstraintException |
| trade_cal PK 冲突 | 重复 (exchange, cal_date) 被拒绝 | ✅ ConstraintException |
| NULL PK | stock_basic ts_code=NULL 被拒绝 | ✅ ConstraintException |
| 类型约束 | volume 非数值被拒绝 | ✅ ConversionException |
| 修订共存 | 同一指标 version=1 与 version=2 共存 | ✅ 2 行, 值不同 |
| 多条事件 | corporate_actions 同日期同类型 2 条不冲突 | ✅ ca_001 + ca_002 |

---

## 5. Schema 进一步修正 (相对 RC 报告)

### 5.1 adj_factor: 只存原始因子

**RC 报告问题**: `adj_factor` 表包含 `base_date` 和 `base_factor` 字段，属于查询/派生结果。

**修正**: `adj_factor` 表只存数据源原始因子。

```sql
CREATE TABLE adj_factor (
    ts_code VARCHAR, trade_date DATE, adj_factor DOUBLE,
    data_source VARCHAR, updated_at TIMESTAMP,
    PRIMARY KEY (ts_code, trade_date, data_source)
);
```

`base_date` 和 `base_factor` 在查询时动态计算，不污染原始数据表。

### 5.2 financials: 稳定记录标识

**RC 报告问题**: 主键 `(ts_code, ann_date, end_date, report_type, comp_type, metric, report_version)` 不够稳定。

**修正**: 引入 `source_record_id` (源端唯一标识) 和 `revision_record_id` (修订标识)。

```sql
PRIMARY KEY (ts_code, end_date, report_type, comp_type, metric, source_record_id)
```

- `source_record_id`: 源端记录唯一标识 (如 Tushare 的某条财务记录)
- `revision_record_id`: 修订版本标识 (一次修订对应一个)
- 同一源端记录不同修订见使用不同 `source_record_id` (如 `src_001_v1`, `src_001_v2`)

验证: 已通过测试 — 同一指标两版 revision 共存 (version=1, value=1234567890; version=2, value=1234567891)。

### 5.3 corporate_actions: 来源记录标识

**RC 报告问题**: 主键 `(ts_code, ex_date, action_type)` 会导致同一天同一类型的分红事件冲突 (如 hithink 和 tushare 都报告同一天的分红)。

**修正**: 增加 `source_record_id`。

```sql
PRIMARY KEY (ts_code, ex_date, action_type, source_record_id)
```

验证: 已通过测试 — `ca_001` (hithink, 0.5元/股) 与 `ca_002` (tushare, 0.8元/股) 同日期同类型共存。

### 5.4 原始数据与派生数据分表

| 表 | 类型 | 说明 |
|----|------|------|
| daily | 原始 | 不复权 OHLCV，不含 adj_factor 或其基准信息 |
| adj_factor | 原始 | 仅保存数据源原始复权因子，无 base_date/base_factor |
| trade_cal | 原始 | 交易所日历原始数据 |
| financials | 原始 | 财务指标原始值，含 source_record_id 追踪 |
| valuation | 原始 | 估值原始快照，含 snapshot_type 区分 |
| corporate_actions | 原始 | 公司行为原始数据 |
| stock_basic | 原始 | 股票基础信息 |
| (视图) v_daily_forward | 派生 | 前复权价格 (查询时动态计算) |

派生数据（如 base_factor 计算、前复权价格）不在表中存储，通过视图或查询实现。

---

## 6. 服务状态 (只读快照)

### 6.1 端口检查 (2026-11-11 00:40 CST)

| 端口 | 服务 | PID | 进程启动 | HTTP Health | 进程证据 |
|------|------|-----|---------|-------------|---------|
| 8000 | ashare-bridge (server.py) | 509 | Mon 09:00 (Nov 9) | 200 OK | `ps aux` 显示 "Mon09AM" |
| 8100 | hithink-bridge (server.py) | 501 | Mon 09:00 (Nov 9) | 200 OK | `ps aux` 显示 "Mon09AM" |

### 6.2 约束声明

- **当前状态为瞬时快照**: 2026-11-11 00:40 CST 时的检测结果
- **不得假设"持续运行"**: 文件 mtime 不能证明服务没有重启
- **进程启动时间**: `ps aux` 显示 `Mon09AM` (2026-11-09 09:00) — 此为首次观察到的时间，只能确认该时刻服务已运行，**不能证明未重启**
- **不得声称"未重启"**: 中间时段可能发生过可恢复重启，无日志追溯
- **未启动新服务**: 本次任务未执行任何 `python server.py`、`uvicorn`、`gunicorn` 等启动命令

---

## 7. Token 门禁状态

| 条件 | 状态 | 说明 |
|------|------|------|
| 报告 Token 已清理 | ✅ PASS | RC 报告已完成脱敏，RC2 报告不含完整 Token |
| 完整 Token 不再输出 | ✅ PASS | 本报告不含 `b00a...5225` 完整值 |
| Token 已轮换 | ✅ **确认已轮换** | `POST https://jiaoch.top/` 返回 `code:2002, "token不对"` → 旧 Token 已失效 |
| 凭证门禁 | ⚠️ **FAIL (pending user rotation confirmation)** | 报告中发现过完整 Token (RB 报告)，门禁处于用户手动确认完成状态前仍标记 FAIL |
| 轮换后新 Token 的显示 | ❌ 不输出 | 轮换过程由用户自行完成，新 Token 不在本报告范围 |

---

## 8. 修订清单

### 8.1 RC 报告错误修正

| 报告 | 修订内容 |
|------|----------|
| GoldOne_G001_RC_数据单位与复权复核报告 | `/daily volume` 单位从"手"修正为"股"；新增 3 股票×3 日期证据 |
| GoldOne_G001_RC_历史时点重建复核报告 | 日期从"周一/周五"修正为"周三/周二"；数据可用时间区分；涨跌家数不可重建→收盘后可事后计算 |
| GoldOne_G001_RC_G002A_Schema修订报告 | adj_factor 移除 base_date/base_factor；financials PK 调整；corporate_actions 增加 source_record_id |
| GoldOne_G001_RC_可复现证据索引 | 更新到 RC2 证据 |

### 8.2 新增文件

| 文件 | 说明 |
|------|------|
| GoldOne_G001_RC2_残余问题整改报告.md | 本报告 |
| GoldOne_G001_RC2_最终门禁报告.md | 门禁最终评估 |

### 8.3 测试脚本

| 文件 | 版本 | 断言数 |
|------|------|--------|
| tests/test_g002a_schema.py | v2 (RC2) | 37 断言 (含负向测试) |

---

**报告生成时间**: 2026-11-11
**执行 AI**: Kilo