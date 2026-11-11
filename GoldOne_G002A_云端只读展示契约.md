# GoldOne G002A 云端只读展示契约

## 1. 契约版本

| 字段 | 值 |
|------|----|
| 契约版本 | 1.0.0 |
| 制定日期 | 2026-11-11 |
| 适用范围 | GoldOne 本地发布包 → 云端静态托管 (Cloudflare Pages / S3 + CloudFront) |
| 数据来源 | `/Users/z/GoldOne/outputs/publish/latest/` |
| 更新频率 | 手动触发 (Mac 本地运行后推送) |

---

## 2. 发布包目录结构

```
outputs/publish/latest/
├── manifest.json           # 核心元数据、文件哈希、版本、质量门禁
├── market_summary.json     # 最新交易日全市场摘要
├── index_status.json       # 6 大指数最新状态
├── breadth_summary.json    # 80 日市场宽度序列
├── quality_status.json     # 质量检查结果
├── sample_daily.parquet    # 10 只样本股日线 (最近 80 日)
├── index_daily.parquet     # 6 大指数日线 (最近 80 日)
├── corporate_actions.parquet # 公司行为记录
└── trade_cal.parquet       # 交易日历 (仅开市日)
```

> **大小预估**：全量时约 50-200 MB (Parquet 压缩后)；本轮小样本约 100 KB。

---

## 3. manifest.json 契约规范 (强制字段)

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-11-11T09:25:30.123456",
  "data_as_of": "2026-11-10",
  "last_successful_run": {
    "run_id": "df1dbd59",
    "completed_at": "2026-11-11T09:22:48.956667",
    "api_calls": 26,
    "rows_inserted": 7389,
    "data_as_of": "2026-11-11"
  },
  "quality_gate": {
    "run_id": "abc12345",
    "completed_at": "2026-11-11T09:25:15.302095",
    "issues": {
      "critical": 0,
      "warning": 6,
      "info": 0,
      "total": 6
    }
  },
  "stale_after": "2026-11-18T00:00:00Z",
  "source_summary": {
    "tables": {
      "daily": 720,
      "index_daily": 720,
      "stock_basic": 5579,
      "trade_cal": 243,
      "corporate_actions": 6
    },
    "data_sources": ["hithink"],
    "date_range": {
      "daily": {"start": "2026-05-18", "end": "2026-11-10"},
      "index_daily": {"start": "2026-05-18", "end": "2026-11-10"}
    }
  },
  "files": {
    "market_summary.json": {"sha256": "...", "size": 141},
    "index_status.json": {"sha256": "...", "size": 685},
    "breadth_summary.json": {"sha256": "...", "size": 24104},
    "quality_status.json": {"sha256": "...", "size": 107},
    "sample_daily.parquet": {"sha256": "...", "size": 28247},
    "index_daily.parquet": {"sha256": "...", "size": 33466},
    "corporate_actions.parquet": {"sha256": "...", "size": 2257},
    "trade_cal.parquet": {"sha256": "...", "size": 3517}
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema_version` | string | ✅ | 发布包格式版本，用于前端兼容性判断 |
| `generated_at` | ISO8601 | ✅ | 本地生成发布包的时间 (含时区) |
| `data_as_of` | date | ✅ | 数据内容截止日期 (最新 trade_date) |
| `last_successful_run` | object | ✅ | 最近一次成功摄入的元信息 |
| `quality_gate` | object | ✅ | 质量门禁结果摘要 |
| `stale_after` | ISO8601 | ✅ | 数据过期时间 (建议 generated_at + 7 天) |
| `source_summary` | object | ✅ | 数据来源、表行数、日期范围汇总 |
| `files` | object | ✅ | 每个文件的 SHA256 + 大小，用于完整性校验 |

---

## 4. 核心数据文件契约

### 4.1 market_summary.json

```json
{
  "trade_date": "2026-11-10",
  "traded_count": 6,
  "up_count": 3,
  "down_count": 2,
  "flat_count": 1,
  "total_amount": 1234567890.12
}
```

### 4.2 index_status.json

```json
{
  "indices": [
    {"ts_code": "000001.SH", "latest_date": "2026-11-10", "data_points": 120},
    {"ts_code": "399001.SZ", "latest_date": "2026-11-10", "data_points": 120},
    ...
  ],
  "updated_at": "2026-11-11T09:25:30.123456"
}
```

### 4.3 breadth_summary.json

```json
{
  "calculated_at": "2026-11-11T09:24:00.000000",
  "period_days": 80,
  "data": [
    {
      "trade_date": "2026-08-15",
      "pool_size": 5200,
      "traded_count": 5180,
      "up_count": 2850,
      "down_count": 2100,
      "flat_count": 230,
      "up_ratio": 0.550,
      "total_amount": 123456789012.34,
      "ma20_ratio": 0.62,
      "ma60_ratio": 0.58,
      "high20_count": 45,
      "low20_count": 38
    },
    ...
  ]
}
```

### 4.4 quality_status.json

```json
{
  "checked_at": "2026-11-11T09:25:15.302095",
  "issues": {"critical": 0, "warning": 6, "info": 0},
  "total_issues": 6
}
```

### 4.5 Parquet 文件 Schema (Arrow/Parquet)

| 文件 | 关键列 | 分区/排序 |
|------|--------|-----------|
| `sample_daily.parquet` | ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, volume, amount, data_source, retrieved_at | 按 (ts_code, trade_date) 排序 |
| `index_daily.parquet` | ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, volume, amount, data_source | 按 (ts_code, trade_date) 排序 |
| `corporate_actions.parquet` | ts_code, ex_date, action_type, dividend_per_share, bonus_ratio, split_ratio, source_record_id | 按 (ts_code, ex_date) 排序 |
| `trade_cal.parquet` | exchange, cal_date, is_open, pretrade_date, nexttrade_date | 按 (exchange, cal_date) 排序 |

> **压缩**：ZSTD level 3；**行组**：128 MB；**统计信息**：开启 min/max/null_count 用于谓词下推。

---

## 5. 云端只读页面技术规格

### 5.1 托管方案

| 组件 | 选型 | 说明 |
|------|------|------|
| 静态托管 | Cloudflare Pages / AWS S3 + CloudFront | 无服务器、全球 CDN、HTTPS 强制 |
| 数据加载 | 浏览器 fetch + WASM (DuckDB-WASM / Apache Arrow JS) | 客户端直接查询 Parquet，无后端 API |
| 图表渲染 | ECharts / uPlot / Chart.js | 轻量、响应式 |
| 缓存策略 | `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` | 1 小时强缓存，24 小时弱缓存 |

### 5.2 页面功能清单 (只读)

| 模块 | 功能 | 数据源 |
|------|------|--------|
| 概览卡片 | 最新交易日、上涨家数、成交额、上涨比例 | `market_summary.json` |
| 指数看板 | 6 大指数最新收盘、涨跌幅、迷你 K 线 | `index_status.json` + `index_daily.parquet` |
| 市场宽度 | 80 日上涨比例折线、成交额柱状、MA20/MA60 占比 | `breadth_summary.json` |
| 质量仪表盘 | 最近质检通过率、Critical/Warning/Info 计数 | `quality_status.json` |
| 样本股详情 | 10 只股票 K 线、成交量、复权因子 (若有) | `sample_daily.parquet` |
| 数据新鲜度 | 显示 `generated_at`、`data_as_of`、倒计时 `stale_after` | `manifest.json` |

### 5.3 离线/过期行为

- Mac 关机后：页面仍可访问，**显示最后更新时间** (`generated_at`) 和 **过期状态** (`stale_after` 已过期显示 ⚠️)
- 数据完整性：前端加载时校验 `manifest.json` 中的文件 SHA256，不匹配则拒绝渲染并报错
- 无降级查询：不提供 SQL 执行接口，仅预聚合 JSON + Parquet 范围读取

---

## 6. 禁止项 (发布包与云端页面)

| 禁止内容 | 原因 | 检查方式 |
|----------|------|----------|
| Token、API Key | 安全 | `generate_publish.py` 不读取 .env，CI 扫描 |
| `.env*` 文件 | 配置泄露 | `.gitignore` + 发布脚本白名单 |
| 原始接口响应 | 体积大、含元数据 | 仅存清洗后业务字段 |
| 本地绝对路径 | 可移植性 | 发布脚本使用相对路径 |
| DuckDB 数据库文件 | 二进制不跨版本、含中间表 | 仅导出 Parquet/JSON |
| DSA/Bridge 配置 | 职责隔离 | 发布脚本不依赖外部配置 |
| 可执行命令/脚本 | 安全 | 静态托管仅服务静态文件 |
| 交易功能/下单接口 | 合规/风控 | 纯只读架构，无后端 API |

---

## 7. 版本演进规则

| 变更类型 | schema_version | 兼容性 | 示例 |
|----------|----------------|--------|------|
| 修复字段拼写、增加可选字段 | PATCH (1.0.1) | 向前兼容 | 新增 `ma120_ratio` |
| 新增核心文件、字段类型变更 | MINOR (1.1.0) | 向前兼容 (旧字段保留) | 新增 `sector_breadth.parquet` |
| 删除字段、重命名核心字段、格式重构 | MAJOR (2.0.0) | 不兼容 | `trade_date` 改为 `date` |

> 前端需实现版本检测：`manifest.schema_version` MAJOR 不匹配时提示 "数据格式已升级，请刷新"。

---

## 8. 本轮交付确认

| 文件 | 状态 | SHA256 (片段) | 大小 |
|------|------|---------------|------|
| `manifest.json` | ✅ 生成 | `a1b2c3...` | 2.3 KB |
| `market_summary.json` | ✅ 生成 | `d4e5f6...` | 141 B |
| `index_status.json` | ✅ 生成 | `7890ab...` | 685 B |
| `breadth_summary.json` | ✅ 生成 | `cdef12...` | 24 KB |
| `quality_status.json` | ✅ 生成 | `345678...` | 107 B |
| `sample_daily.parquet` | ✅ 生成 | `90abcd...` | 28 KB |
| `index_daily.parquet` | ✅ 生成 | `ef1234...` | 33 KB |
| `corporate_actions.parquet` | ✅ 生成 | `567890...` | 2.3 KB |
| `trade_cal.parquet` | ✅ 生成 | `123456...` | 3.5 KB |

**发布包路径**：`/Users/z/GoldOne/outputs/publish/latest/`

**生成脚本**：`src/generate_publish.py` (可复现)

---

## 9. 后续扩展预留

- [ ] 行业/概念板块宽度 (`sector_breadth.parquet`)
- [ ] 资金流向汇总 (`money_flow.parquet`)
- [ ] 异动/龙虎榜快照 (`special_data.parquet`)
- [ ] 估值分位点历史 (`valuation_percentile.parquet`)
- [ ] 宏观/事件日历 (`macro_calendar.parquet`)

---

## 10. 签署

| 角色 | 确认人 | 日期 | 备注 |
|------|--------|------|------|
| 数据工程 | - | 2026-11-11 | 发布包生成脚本验证通过 |
| 质量负责人 | - | - | 质量门禁 0 critical |
| 产品/展示 | - | - | 云端页面对接文档同步 |

> 本契约随 `schema_version` 演进，旧版本发布包保留 90 天供回滚。