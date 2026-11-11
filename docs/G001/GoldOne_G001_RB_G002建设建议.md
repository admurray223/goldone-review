# GoldOne_G001_RB G002建设建议

**任务编号**: GoldOne-G001-RB
**执行日期**: 2026-11-10
**基于**: 隔离整改报告、Bridge审计报告、数据源能力验证报告、数据质量报告

---

## 1. 数据源选型决策

### 1.1 核心数据源矩阵

| 数据需求 | 主源 (Primary) | 交叉验证 (Cross-check) | 备选/补充 | 选型理由 |
|----------|----------------|------------------------|-----------|----------|
| **A股主要指数日线 2015-2026** | **Tushare index_daily** | hithink-finance index.history (近5年) | ashare-bridge | 仅 Tushare 无时间窗口限制 |
| **A股全历史股票池 (含退市)** | **Tushare stock_basic** | 无 | 无 | 唯一含 list_date/delist_date/list_status |
| **个股日线 2015-2026 (复权)** | **Tushare daily + adj_factor** | hithink-finance market.history (近10年) | ashare-bridge /daily | Tushare 覆盖最全，adj_factor 标准 |
| **个股分钟线 (近期)** | **ashare-bridge /bars** | 无 | 无 | 唯一提供 240 根 1m K线 |
| **复权因子/公司行为** | **Tushare adj_factor** | hithink-finance market.corporate-actions | 无 | Tushare 完整历史，CLI 近年补充 |
| **财务三表 + 实际披露日** | **Tushare income/balancesheet/cashflow** | hithink-finance financials.* | 无 | 双源均含 ann_date/f_ann_date/period_end |
| **估值快照 (PE/PB/PS/PCF)** | **hithink-finance valuation.snapshot** | 无 | 无 | 唯一提供 TTM/MRQ 估值 |
| **交易日历** | **Tushare trade_cal** | hithink-finance market.calendar | 无 | Tushare 全历史，CLI 仅 1 年 |
| **行业/概念分类** | **Tushare stock_basic.industry** | hithink-finance index.catalog | 无 | Tushare 基础，CLI 同花顺体系更丰富 |
| **全球主要指数** | **Yfinance (新增)** | 无 | 无 | 现有源均不覆盖 |

---

### 1.2 数据源组合架构

```
┌─────────────────────────────────────────────────────────────┐
│                      GoldOne Data Layer                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Tushare     │  │ hithink-     │  │  ashare-     │       │
│  │  (核心持久化) │  │ finance CLI  │  │  bridge      │       │
│  │              │  │  (实时/估值/  │  │  (分钟线/    │       │
│  │  - 全历史日线 │  │   财务披露日) │  │   显式日线)   │       │
│  │  - 复权因子   │  │              │  │              │       │
│  │  - 股票池/日历 │  │              │  │              │       │
│  │  - 财务三表   │  │              │  │              │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         └─────────────────┼─────────────────┘                │
│                           ▼                                   │
│              ┌────────────────────────┐                       │
│              │  GoldOne 本地 DuckDB   │                       │
│              │  (统一存储/查询层)      │                       │
│              └────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. G002 实施路线图

### Phase 1: 基础设施与核心镜像 (Week 1-2)

| 任务 | 交付物 | 预估工时 | 依赖 |
|------|--------|----------|------|
| 1.1 GoldOne 本地 DuckDB 初始化 | `/Users/z/GoldOne/data/goldone.duckdb` | 0.5 天 | 无 |
| 1.2 Tushare 全量同步脚本 (分批、断点续传) | `scripts/sync_tushare.py` | 2 天 | Tushare token |
| 1.3 核心表设计: daily, adj_factor, stock_basic, trade_cal, financials | Schema DDL | 1 天 | 1.1 |
| 1.4 增量更新调度 (日度) | `scripts/daily_incremental.py` + cron | 1 天 | 1.2 |
| 1.5 单元测试与数据校验 | `tests/test_data_integrity.py` | 1 天 | 1.3 |

**里程碑**: 本地拥有 2015-2026 全市场日线、复权因子、股票池、日历、财务三表。

### Phase 2: 实时与估值接入 (Week 2-3)

| 任务 | 交付物 | 预估工时 | 依赖 |
|------|--------|----------|------|
| 2.1 hithink-finance CLI 封装客户端 | `src/data/hithink_client.py` | 1 天 | CLI 已验证 |
| 2.2 实时快照采集服务 (盘中 1min) | `src/services/realtime_collector.py` | 1.5 天 | 2.1 |
| 2.3 估值快照日度采集 | `src/services/valuation_collector.py` | 0.5 天 | 2.1 |
| 2.4 财报披露日事件流 | `src/services/earnings_calendar.py` | 1 天 | 2.1 |
| 2.5 ashare-bridge 分钟线采集 | `src/services/minute_collector.py` | 1 天 | Bridge 运行 |

**里程碑**: 具备盘中实时行情、估值指标、财报事件、分钟线采集能力。

### Phase 3: 统一查询层与回测就绪 (Week 3-4)

| 任务 | 交付物 | 预估工时 | 依赖 |
|------|--------|----------|------|
| 3.1 统一数据访问接口 (DataProvider) | `src/data/provider.py` | 2 天 | Phase 1-2 |
| 3.2 复权价格计算引擎 (前/后复权) | `src/engine/adjuster.py` | 1.5 天 | adj_factor 就绪 |
| 3.3 时点重建接口 (as-of-date 查询) | `src/data/point_in_time.py` | 2 天 | 财报披露日就绪 |
| 3.4 回测数据切片导出 (Parquet/CSV) | `src/export/backtest_slice.py` | 1 天 | 3.1 |
| 3.5 数据质量监控看板 | `src/monitoring/quality_dashboard.py` | 1 天 | 3.1 |

**里程碑**: 可支持向量化回测、事件驱动回测、时点正确性验证。

### Phase 4: 全球指数与另类数据 (Week 4+)

| 任务 | 交付物 | 预估工时 | 备注 |
|------|--------|----------|------|
| 4.1 Yfinance 接入 (SPX/NDX/NKY/KOSPI) | `src/data/yfinance_client.py` | 1 天 | 补充全球宏观 |
| 4.2 龙虎榜/资金流向历史 (hithink-finance special) | `src/data/special_collector.py` | 1 天 | 仅近 1 年 |
| 4.3 行业轮动因子计算 | `src/factors/sector_rotation.py` | 2 天 | 依赖指数成分 (受限) |

---

## 3. 关键技术决策

### 3.1 复权计算标准

```python
# GoldOne 统一前复权算法
def forward_adjust(raw_close, adj_factor, base_date_factor):
    """
    前复权价 = 原始收盘价 × (当日复权因子 / 基准日复权因子)
    基准日: 回测结束日或最新交易日
    """
    return raw_close * (adj_factor / base_date_factor)

# 存储策略
- 存储: 原始不复权价格 + 复权因子
- 计算: 查询时动态生成前/后复权价格
- 缓存: 热点标的预计算前复权列存
```

### 3.2 时点正确性保证

| 数据类型 | 可用时间戳 | 回测使用规则 |
|----------|------------|--------------|
| 日线行情 | trade_date (收盘后) | **仅可用于 T+1 决策** |
| 财报指标 | ann_date/f_ann_date (披露日) | **仅可用于披露日当天或之后** |
| 估值指标 | valuation_date (计算日) | **仅可用于计算日收盘后** |
| 分钟线 | bar_time (K线结束时刻) | **仅可用于该分钟结束后** |
| 实时快照 | server_time (桥接器响应) | **不可用于回测，仅盘中监控** |

**硬性约束**: 任何回测查询必须显式传入 `as_of_date`，系统自动过滤未来数据。

### 3.3 存储Schema设计 (DuckDB)

```sql
-- 核心日线表 (分区按年)
CREATE TABLE daily (
    ts_code      VARCHAR,    -- 300274.SZ
    trade_date   DATE,       -- 2024-01-02
    open         DOUBLE,
    high         DOUBLE,
    low          DOUBLE,
    close        DOUBLE,     -- 不复权收盘价
    pre_close    DOUBLE,
    volume       BIGINT,     -- 股
    amount       DOUBLE,     -- 元
    adj_factor   DOUBLE,     -- 复权因子 (关联表)
    PRIMARY KEY (ts_code, trade_date)
) PARTITION BY YEAR(trade_date);

-- 复权因子表
CREATE TABLE adj_factor (
    ts_code      VARCHAR,
    trade_date   DATE,
    adj_factor   DOUBLE,     -- 累积复权因子
    PRIMARY KEY (ts_code, trade_date)
);

-- 股票基础信息 (含退市)
CREATE TABLE stock_basic (
    ts_code      VARCHAR PRIMARY KEY,
    name         VARCHAR,
    industry     VARCHAR,
    area         VARCHAR,
    market       VARCHAR,    -- 主板/创业板/科创板/北交所
    list_date    DATE,       -- 上市日
    delist_date  DATE,       -- 退市日 (NULL=在册)
    list_status  VARCHAR     -- L/D/P
);

-- 财务三表 (长表格式)
CREATE TABLE financials (
    ts_code      VARCHAR,
    ann_date     DATE,       -- 实际披露日
    f_ann_date   DATE,       -- 修正披露日
    end_date     DATE,       -- 报告期末
    report_type  VARCHAR,    -- annual/quarterly
    comp_type    VARCHAR,    -- 合并/母公司
    metric       VARCHAR,    -- total_revenue, n_income_attr_p 等
    value        DOUBLE,
    PRIMARY KEY (ts_code, ann_date, end_date, metric)
);

-- 交易日历
CREATE TABLE trade_cal (
    exchange     VARCHAR,
    cal_date     DATE PRIMARY KEY,
    is_open      BOOLEAN,
    pretrade_date DATE
);

-- 估值快照
CREATE TABLE valuation (
    ts_code      VARCHAR,
    trade_date   DATE,
    pe_ttm       DOUBLE,
    pe_mrq       DOUBLE,
    pb_mrq       DOUBLE,
    ps_ttm       DOUBLE,
    pcf_ttm      DOUBLE,
    PRIMARY KEY (ts_code, trade_date)
);
```

---

## 4. 成本与风险评估

### 4.1 成本估算

| 成本项 | 估算 | 说明 |
|--------|------|------|
| **Tushare 数据权限** | 0 元 (已有 token) | 免费额度 80/min, 500/day |
| **hithink-finance CLI** | 可能需企业授权 | 当前可用，长期需确认商业条款 |
| **存储 (DuckDB)** | < 10 GB / 年 | 本地 SSD，极低成本 |
| **计算资源** | 现有机器 | 无额外云成本 |
| **开发工时** | ~60 人小时 | 4 阶段约 4 周 |
| **维护工时** | ~4 人小时/月 | 增量同步监控、质量巡检 |

**总成本**: 极低 (主要投入人力)，无硬性付费依赖。

### 4.2 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 | 应急预案 |
|------|------|------|----------|----------|
| Tushare 限流导致同步失败 | 高 | 中 | 指数退避重试、分批同步、本地断点续传 | 降级用 hithink-finance 补充 |
| hithink-finance 服务停止/收费 | 中 | 高 | 核心数据已本地化 (Tushare)，CLI 仅作实时/估值补充 | 切换实时源至 ashare-bridge + 免费行情 |
| ashare-bridge 上游接口变更 | 低 | 中 | 版本锁定 Ashare.py、监控健康检查 | 切换至 Tushare 历史 + 分钟线放弃 |
| 复权因子算法不一致 | 低 | 高 | 统一用 Tushare adj_factor 重算，锁定算法版本 | 回测前全量复权一致性校验 |
| 财报披露日粒度不足 (无时分秒) | 确定 | 中 | 明确标注"仅日期粒度"，回测假设盘后披露 | 标注局限，不做盘内事件驱动 |
| 指数成分股历史缺失 | 确定 | 中 | 仅做指数层面回测，不做成分股权重还原 | 评估高积分 Tushare 接口或放弃 |

---

## 5. 待解决问题 (Blockers)

| 编号 | 问题 | 状态 | 负责 | 截止 |
|------|------|------|------|------|
| B-01 | hithink-finance CLI 长期商业授权确认 | 待确认 | 产品方 | G002 启动前 |
| B-02 | Tushare token 长期有效性 (jiaoch.top endpoint) | 待监控 | 运维 | 持续 |
| B-03 | 全球指数数据源选型 (Yfinance vs 付费) | 待决策 | 架构师 | Phase 4 前 |
| B-04 | 指数成分股历史数据获取方案 | 无解 | - | 记录为已知局限 |
| B-05 | 盘中市场宽度数据 (涨跌家数历史) | 无低成本源 | - | 记录为已知局限 |

---

## 6. G002 启动建议

### 6.1 启动条件检查清单

| 条件 | 状态 | 证据 |
|------|------|------|
| GoldOne 独立目录就绪 | ✅ | 隔离整改报告 |
| G001 报告迁移完成 | ✅ | 4 文件 SHA-256 校验通过 |
| 核心数据源验证通过 | ✅ | Tushare/hithink-finance/Bridge 均实测通过 |
| 数据质量基线建立 | ✅ | 跨源对比、时点边界明确 |
| 无外部项目破坏 | ✅ | DSA/Bridge Git 状态正常 |
| 无敏感泄漏 | ✅ | Token 仅在 GoldOne venv/.env |

### 6.2 建议决策

**建议: 批准启动 G002**

**理由**:
1. 物理隔离完成，GoldOne 具备独立运行环境
2. 核心数据源 (Tushare + hithink-finance + 两 Bridge) 均经实测验证，覆盖 2015-2026 全维度需求
3. 数据质量风险已量化，复权口径、时点边界、单位换算均有明确规范
4. 成本极低，无硬性付费阻断，技术路径清晰
5. 已知局限 (指数成分历史、盘中宽度) 在可接受范围，不影响核心趋势/选股回测

### 6.3 优先级排序

| 优先级 | 工作包 | 理由 |
|--------|--------|------|
| P0 | Tushare 全量同步 + 本地 DuckDB 建立 | 所有下游依赖的基石 |
| P0 | 复权计算引擎 + 时点查询接口 | 回测正确性核心 |
| P1 | hithink-finance 实时/估值/财报日采集 | 补充 Tushare 无实时/估值能力 |
| P1 | ashare-bridge 分钟线采集 | 独家分钟线来源 |
| P2 | 统一 DataProvider + 回测切片导出 | 研发接口标准化 |
| P3 | 全球指数 (Yfinance) + 特色数据 | 宏观/另类补充 |

---

## 7. 附件: 关键接口契约

### 7.1 Tushare 同步接口规范

```python
# scripts/sync_tushare.py
class TushareSyncer:
    def sync_daily(self, start_date: str, end_date: str, batch_size: int = 100) -> SyncResult
    def sync_adj_factor(self, start_date: str, end_date: str) -> SyncResult
    def sync_stock_basic(self) -> SyncResult
    def sync_financials(self, report_type: str = 'annual') -> SyncResult
    def incremental_update(self, last_sync_date: str) -> SyncResult
```

### 7.2 统一查询接口规范

```python
# src/data/provider.py
class DataProvider:
    def get_daily(self, ts_codes: List[str], start: date, end: date, 
                  adjust: Literal['none', 'forward', 'backward'] = 'forward') -> pd.DataFrame
    def get_adj_factor(self, ts_codes: List[str], start: date, end: date) -> pd.DataFrame
    def get_financials(self, ts_codes: List[str], metric: str, 
                       as_of_date: date) -> pd.DataFrame  # 时点正确
    def get_valuation(self, ts_codes: List[str], trade_date: date) -> pd.DataFrame
    def get_minute_bars(self, ts_code: str, trade_date: date) -> pd.DataFrame
    def get_trade_cal(self, start: date, end: date) -> pd.DataFrame
    def get_stock_universe(self, as_of_date: date, include_delisted: bool = True) -> pd.DataFrame
```

---

**报告生成时间**: 2026-11-10 23:30:00
**执行 AI**: Kilo
**决策**: 建议批准启动 G002