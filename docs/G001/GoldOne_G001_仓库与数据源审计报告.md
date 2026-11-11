# GoldOne_G001_仓库与数据源审计报告

**任务编号**：GoldOne-G001
**生成日期**：2026-11-10
**审计对象**：DSA真实仓库 `daily-stock-analysis-phase2c-round5`

---

## 1. 真实仓库身份确认

| 项目 | 详情 |
|------|------|
| **仓库路径** | `/Users/z/daily-stock-analysis-phase2c-round5` |
| **Git远程地址** | `https://github.com/admurray223/daily-stock-analysis.git` (fetch/push) |
| **当前分支** | `phase2c-round5-checkpoint` |
| **最新提交** | `7ba168e` - `test(reporting): close data recovery mutation evidence` |
| **提交时间** | 2026-11-10 (近期) |
| **工作树状态** | 干净，仅有3个未跟踪文件（报告文档和测试文件） |

**确认结论**：已唯一定位并确认为指定的DSA真实仓库。无其他同名目录干扰。

---

## 2. 当前Git状态

```
On branch phase2c-round5-checkpoint
Untracked files:
  DSA_R1_CHECKPOINT_CLOSURE_REPORT.md
  DSA_R5K_CHILD_GUARD_FINAL_EVIDENCE_REPORT.md
  tests/test_sina_https_transport.py
```

无未提交的代码修改，仓库处于稳定状态。

---

## 3. 数据源清单与可调用性审计

### 3.1 数据源配置矩阵

| 数据源 | 代码接入状态 | 环境变量配置 | Python包安装 | 实际可调用 | 备注 |
|--------|-------------|-------------|-------------|-----------|------|
| **Tushare Pro** | ✅ 完整实现 (`tushare_fetcher.py`) | ✅ Token已配置<br>`TUSHARE_TOKEN=b00a1bed...`<br>`TUSHARE_HTTP_URL=https://jiaoch.top/`<br>`TUSHARE_PREFERRED_FROM=2026-10-26`<br>`TUSHARE_PREFERRED_UNTIL=2026-11-25` | ❌ **未安装** | ❌ **不可用** | Token有效但缺少 `tushare` 包；偏好窗口至2026-11-25 |
| **Akshare (东财/新浪/腾讯)** | ✅ 完整实现 (`akshare_fetcher.py`) | 无需Token | ❌ **未安装** | ❌ **不可用** | 优先级1，防封禁策略完善但缺包 |
| **Efinance (东财)** | ✅ 完整实现 (`efinance_fetcher.py`) | 无需Token | ❌ **未安装** | ❌ **不可用** | 优先级0，全市场快照能力但缺包 |
| **Baostock** | ✅ 完实现 (`baostock_fetcher.py`) | 无需Token | ❌ **未安装** | ❌ **不可用** | 优先级3 |
| **Yfinance (美股/全球)** | ✅ 完整实现 (`yfinance_fetcher.py`) | 无需Token | ❌ **未安装** | ❌ **不可用** | 优先级4，美股指数/股票回退源 |
| **Longbridge** | ✅ 完整实现 (`longbridge_fetcher.py`) | 需API Key | ❌ **未安装** | ❌ **不可用** | 港股/美股源 |
| **Futu** | ✅ 完整实现 (`futu_fetcher.py`) | 需OpenD | ❌ **未安装** | ❌ **不可用** | 港股持仓/基本面 |
| **TickFlow** | ✅ 完整实现 (`tickflow_fetcher.py`) | 需API Key | ❌ **未安装** | ❌ **不可用** | 实时/历史行情，优先级2 |
| **腾讯直连** | ✅ 完整实现 (`tencent_fetcher.py`) | 无需Token | ✅ 仅需requests | ⚠️ **仅实时** | 实时行情可用，无历史接口 |
| **新浪财经** | ✅ 通过Akshare间接 | 无需Token | ❌ 依赖akshare | ❌ **不可用** |  |
| **AlphaVantage** | ✅ 完整实现 (`alphavantage_fetcher.py`) | 需API Key | ✅ 仅需requests | ⚠️ **仅美股** | 全球指数/汇率 |
| **Finnhub** | ✅ 完整实现 (`finnhub_fetcher.py`) | 需API Key | ✅ 仅需requests | ⚠️ **仅美股** | 美股实时/基本面 |

### 3.2 同花顺/实时双源架构

| 组件 | 状态 | 说明 |
|------|------|------|
| **hithink-finance CLI** | ✅ 已安装 v0.1.5 | `/Users/z/.local/bin/hithink-finance` |
| **统一API Key** | ✅ 已配置 | `hithink-finance auth status` 显示 configured=true |
| **本地DuckDB** | ⚠️ 存在但**空库** | 路径：`~/Library/Application Support/hithink-finance/data/market.duckdb`<br>表结构完整(v_daily, v_daily_qfq等)但**0只股票、0条K线** |
| **HithinkAshareFetcher** | ✅ 代码完整 (`hithink_ashare_fetcher.py`) | 需外部Bridge服务：`HITHINK_BRIDGE_BASE_URL`(默认8100)、`ASHARE_BRIDGE_BASE_URL`(默认8000) |
| **实时双源验证** | ✅ 配置启用 | `.env`中 `HITHINK_ASHARE_ENABLED=true`<br>`REALTIME_SOURCE_PRIORITY=hithink_ashare,tushare,tencent,akshare_sina,efinance,akshare_em` |

**关键发现**：hithink-finance CLI已就绪且认证通过，**但本地数据库为空**，需执行 `data init` 或 `data sync` 才能离线查询。双源实时架构代码完整，但依赖两个本地HTTP Bridge服务（未在本审计中验证是否运行）。

### 3.3 现有数据库与缓存情况

| 数据库 | 路径 | 大小 | 核心表 | 数据范围 | 记录数 |
|--------|------|------|--------|----------|--------|
| **DSA主库(SQLite)** | `data/stock_analysis.db` | ~1.08 GB | `stock_daily`, `index_daily`, `fundamental_snapshot`, `realtime_ticks`等 | 见下文 | 330万+日线 |
| **DuckDB(hithink)** | `~/Library/.../market.duckdb` | ~几MB | `raw_kline_daily`, `v_daily_qfq`, `stg_kline_daily`等 | **空** | 0 |
| **交易数据库** | `data/trading_data.db` | 0 KB | 空 | - | 0 |
| **快照缓存** | `data/snapshot_cache.json` | 不存在 | - | - | - |

#### DSA主库 `stock_daily` 表详情
- **时间范围**：2023-09-04 至 2026-11-10（约 **3.2年**，769个交易日）
- **股票覆盖**：5,207只（含退市）
- **总记录数**：3,311,442行
- **列字段**：code, date, open, high, low, close, volume, amount, pct_chg, ma5, ma10, ma20, volume_ratio, data_source, canonical_id, turn

#### DSA主库 `index_daily` 表详情
| 指数代码 | 名称 | 时间范围 | 记录数 | 数据源标识 |
|---------|------|----------|--------|-----------|
| 000001.SH | 上证指数 | 2026-11-02 ~ 2026-11-10 | 7 | tushare |
| 399006.SZ | 创业板指 | 2026-11-02 ~ 2026-11-10 | 7 | tushare |
| 399001.SZ | 深证成指 | 2026-11-02 ~ 2026-11-10 | 7 | tushare |
| 000688.SH | 科创50 | 2026-11-02 ~ 2026-11-10 | 7 | tushare |
| sh.000016 | 上证50 | 2023-09-04 ~ 2026-10-29 | 761 | akshare/efinance |
| sh.000300 | 沪深300 | 2023-09-04 ~ 2026-10-29 | 761 | akshare/efinance |
| sh.000905 | 中证500 | 2023-09-04 ~ 2026-10-29 | 761 | akshare/efinance |
| sz.399006 | 创业板指(旧码) | 2023-09-04 ~ 2026-10-29 | 761 | akshare/efinance |

**关键缺口**：
- ❌ **中证1000 (000852)** 完全缺失
- ❌ 2015-2022年历史数据**完全缺失**
- ❌ 主要指数仅有最近7天或3.2年数据

#### 基本面数据 (`fundamental_snapshot`)
- 仅 **24条** 记录
- 全部为单一股票 **300274 (阳光电源)**
- 时间集中在 **2026-11-02 至 2026-11-03**
- 多数基本面bundle返回 `not_supported`
- TushareFetcher偶尔成功但多数失败/为空

---

## 4. 现有能力复用建议

### 4.1 可直接复用的代码能力（只读模式）

| 能力模块 | 复用价值 | 接入方式 |
|---------|---------|---------|
| **DataFetcherManager** (`data_provider/base.py`) | ⭐⭐⭐⭐⭐ 统一路由、熔断、降级、优先级管理 | GoldOne独立进程import，只读调用 |
| **标准化列定义** (`STANDARD_COLUMNS`) | ⭐⭐⭐⭐ 统一字段契约 | 直接复用常量 |
| **代码归一化** (`normalize_stock_code`) | ⭐⭐⭐⭐⭐ 多格式代码统一转换 | 直接复用函数 |
| **实时行情类型** (`realtime_types.py`) | ⭐⭐⭐⭐ UnifiedRealtimeQuote等 | 直接复用dataclass |
| **Tushare端点策略** (`tushare_endpoint_policy.py`) | ⭐⭐⭐ HTTPS强制、窗口治理 | 复用政策逻辑 |
| **基本面适配器** (`fundamental_adapter.py`) | ⭐⭐⭐ 多源基本面聚合 | 复用聚合逻辑 |
| **指数映射/识别** (`us_index_mapping.py`, `stock_index_loader.py`) | ⭐⭐⭐ 标准指数代码映射 | 复用映射表 |

### 4.2 需隔离/重建的组件

| 组件 | 隔离策略 |
|------|---------|
| **SQLite主库** | GoldOne建立**独立DuckDB/Parquet**数据湖，只读访问DSA库做对比校验 |
| **实时双源Bridge** | GoldOne自建或复用HTTP端点，不共享进程内状态 |
| **配置管理** | GoldOne独立 `.env.goldone`，不读写DSA `.env` |
| **日志/输出目录** | GoldOne独立 `logs/goldone/`, `output/goldone/` |
| **缓存目录** | GoldOne独立 `data/goldone/cache/` |

### 4.3 推荐的复用架构

```
GoldOne Project (独立目录)
├── config/
│   ├── .env.goldone          # 独立配置
│   └── sources.yaml          # 数据源优先级/参数
├── data/
│   ├── goldone.duckdb        # 本地历史数据湖 (主存储)
│   ├── parquet/              # 分区Parquet导出 (研究友好)
│   └── cache/                # 请求级缓存
├── src/
│   ├── fetcher/              # 复用DSA fetcher类 (只读import)
│   ├── validator/            # 数据质量校验
│   ├── builder/              # 历史数据构建管线
│   └── research/             # 研究专用查询接口
├── scripts/
│   ├── sync_history.py       # 历史回补脚本
│   ├── validate.py           # 质量门禁
│   └── export_parquet.py     # 导出研究格式
└── tests/
    └── test_data_quality.py  # 数据质量测试
```

**核心原则**：
- DSA仓库**只读**，不修改任何代码/配置/数据
- GoldOne通过 `sys.path` 引用DSA的 `data_provider` 模块
- 所有历史数据落盘到GoldOne自有DuckDB/Parquet
- 实时双源架构复用DSA的 `HithinkAshareFetcher` 类，但指向GoldOne自有Bridge端点

---

## 5. 附录：关键配置证据

### 5.1 .env 关键数据源配置 (脱敏)
```bash
TUSHARE_TOKEN=b00a1bed... (已配置)
TUSHARE_HTTP_URL=https://jiaoch.top/
TUSHARE_PREFERRED_FROM=2026-10-26
TUSHARE_PREFERRED_UNTIL=2026-11-25
HITHINK_ASHARE_ENABLED=true
REALTIME_SOURCE_PRIORITY=hithink_ashare,tushare,tencent,akshare_sina,efinance,akshare_em
```

### 5.2 hithink-finance CLI 状态
```json
{"ok":true,"command":"auth.status","data":{"method":"api-key","profile":"default","configured":true}}
{"ok":true,"command":"data.status","data":{"path":"/Users/z/Library/Application Support/hithink-finance/data/market.duckdb","version":1}}
```

### 5.3 本地DuckDB表结构
```
_import_batches, _meta, calc_adjust_factor_daily, dim_symbol,
raw_adjustment_events, raw_kline_daily, stg_adjustment_events,
stg_kline_daily, stg_symbol, v_daily, v_daily_hfq, v_daily_qfq, v_symbol
```
**数据行数**：全表0行

---

**报告生成时间**：2026-11-10
**审计人**：Kilo (自动化审计)
**下一步**：见《GoldOne_G001_数据覆盖与质量报告》与《GoldOne_G001_数据建设建议方案》