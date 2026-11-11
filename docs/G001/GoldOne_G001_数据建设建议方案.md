# GoldOne_G001_数据建设建议方案

**任务编号**：GoldOne-G001
**生成日期**：2026-11-10
**基准仓库**：`daily-stock-analysis-phase2c-round5` (HEAD: 7ba168e)
**审核依据**：《仓库与数据源审计报告》、《数据覆盖与质量报告》

---

## 1. 推荐主数据源策略

### 1.1 分层数据源架构

| 数据层级 | 主数据源 | 备用数据源 | 说明 |
|---------|---------|-----------|------|
| **A股历史日线(OHLCV+复权+公司行为)** | **hithink-finance CLI** (`data init/sync`) | Tushare Pro (需高积分) | hithink提供10年窗口、前复权、公司行为、统一因子；CLI自带DuckDB存储、增量同步、校验 |
| **A股实时行情(盘中/收盘快照)** | **Hithink + Ashare 双源** (DSA现有架构) | 腾讯直连 / 新浪财经 | 复用DSA `HithinkAshareFetcher`，双源价格交叉验证，防单源异常 |
| **主要指数日线(含中证1000)** | **hithink-finance index.history** | Tushare `index_daily` / Akshare `stock_zh_index_daily_em` | hithink覆盖同花顺全指数体系，含中证1000；Tushare作补充 |
| **全球指数(标普/纳指/日经/KOSPI)** | **Yfinance** (Python) | AlphaVantage / Finnhub | yfinance免费、覆盖全、Python原生；AlphaVantage作限流备用 |
| **公司基本面(利润/资产/现金流/指标/公告日)** | **hithink-finance financials.* 系列** | Tushare `fina_indicator`/`income`/`balancesheet`/`cashflow` | hithink提供标准化报告期、公告日、修订历史；Tushare作字段补充 |
| **行业/概念/指数成分股历史** | **hithink-finance index.constituents + index.catalog** | Tushare `index_classify`/`index_member` | 同花顺行业分类更细、更新及时；需历史快照机制 |
| **特色数据(龙虎榜/涨停池/异动/资金流)** | **hithink-finance special.* 系列** | 东财/同花顺网页爬虫(慎用) | 仅today-only，历史不可补，仅作实时参考 |

### 1.2 核心决策理由

1. **hithink-finance CLI 为首选主源**：
   - 统一API Key，单一账号体系
   - 原生支持10年历史窗口(`ten-years`)，覆盖2015-2026
   - 内置DuckDB本地存储、增量同步、复权因子重建(`data repair`)
   - 提供结构化输出、SQL查询、Parquet导出，极适合研究
   - 同花顺数据质量在A股数据源中处于第一梯队

2. **Tushare Pro 为高优先级备用/补充源**：
   - 已配置Token且偏好窗口至2026-11-25
   - 接口稳定、文档完善、支持批量下载
   - **前提**：需购买积分(≥1200积分/天可支撑全市场日线回补)或申请高权限

3. **Yfinance 为全球指数唯一免费可行源**：
   - 无需Key、覆盖美/日/港/台/韩主要指数
   - Python原生、易集成

---

## 2. 需补充的数据与建设任务

### 2.1 历史数据回补清单 (按优先级)

| 优先级 | 数据集 | 目标范围 | 预估工作量 | 依赖源 |
|--------|--------|----------|-----------|--------|
| **P0-阻断级** | A股全市场日线+复权因子+公司行为 | 2015-01-01 ~ 2026-11-10 | 2-3天(下载+导入) | hithink `data init` |
| **P0-阻断级** | 主要指数日线(含中证1000) | 2015-01-01 ~ 2026-11-10 | 含上项 | hithink `index.history` |
| **P0-阻断级** | 股票上市/退市日期表 | 全历史 | 含上项 | hithink `symbol.list` 衍生 |
| **P1-核心级** | 公司基本面(利润/资产/现金流/指标) | 2015-2026 全报告期 | 1-2天 | hithink `financials.*` |
| **P1-核心级** | 财报实际公告日期 | 2015-2026 全披露 | 含上项 | hithink 含公告日字段 |
| **P1-核心级** | 历史行业/概念分类快照 | 每季度末/半年末快照 | 1天 | hithink `index.constituents` + 板块映射 |
| **P2-增强级** | 全球主要指数日线 | 2015-2026 | 4小时 | Yfinance 批量下载 |
| **P2-增强级** | 停牌/ST/涨跌停历史标识 | 2015-2026 | 霐入hithink特色数据或推导 | hithink `special.*` / 价格推导 |
| **P3-研究级** | 龙虎榜/资金流/北向/融资融券 | 2015-2026 (若可得) | 视源而定 | hithink / Tushare高积分 |

### 2.2 技术建设任务

| 任务 | 说明 | 预估工时 |
|------|------|---------|
| **GoldOne独立项目脚手架** | 目录结构、配置管理、日志、CLI入口 | 4小时 |
| **数据湖存储层** | DuckDB主库 + 分区Parquet导出(按年/月/股票) | 8小时 |
| **历史回补管线** | `sync_history.py`：分批下载、断点续传、校验入库 | 16小时 |
| **增量同步管线** | `sync_incremental.py`：交易日收盘后增量更新 | 8小时 |
| **数据质量门禁** | `validate.py`：完整性/一致性/异常值/未来泄漏检查 | 16小时 |
| **研究查询接口** | `research_api.py`：面板构建、因子计算、时点切片 | 24小时 |
| **时点合规重建器** | `point_in_time.py`：给定日期重建当时可知信息集 | 16小时 |
| **跨源一致性校验** | 样本抽查：hithink vs Tushare vs Yfinance 价格/基本面 | 8小时 |
| **文档与运行手册** | 数据字典、更新日志、故障排查、权限说明 | 8小时 |

**总计预估**：~108工时 (约 2-3 周单人投入)

---

## 3. GoldOne 与 DSA 隔离方案

### 3.1 物理隔离

```
# 目录结构
/Users/z/
├── daily-stock-analysis-phase2c-round5/   # DSA (只读，不动)
│   ├── data/stock_analysis.db             # DSA主库 (只读引用)
│   ├── data_provider/                     # 复用代码 (import only)
│   └── .env                               # DSA配置 (不读不写)
│
└── GoldOne/                               # GoldOne独立项目
    ├── config/
    │   ├── .env.goldone                   # 独立配置
    │   └── sources.yaml                   # 数据源策略
    ├── data/
    │   ├── goldone.duckdb                 # 主历史数据湖
    │   ├── parquet/                       # 研究友好导出
    │   │   ├── daily/                     # 按年分区: daily_2015.parquet...
    │   │   ├── fundamental/               # 按报告期分区
    │   │   ├── index/                     # 指数数据
    │   │   └── industry/                  # 行业快照
    │   └── cache/                         # 请求级缓存
    ├── src/
    │   ├── fetcher/                       # 封装DSA fetcher + hithink CLI
    │   ├── builder/                       # 历史构建管线
    │   ├── validator/                     # 质量门禁
    │   ├── point_in_time/                 # 时点重建
    │   └── research/                      # 研究接口
    ├── scripts/
    │   ├── sync_history.py
    │   ├── sync_incremental.py
    │   ├── validate.py
    │   └── export_parquet.py
    ├── tests/
    │   └── test_data_quality.py
    ├── logs/goldone/
    └── output/goldone/
```

### 3.2 代码复用方式 (只读 Import)

```python
# GoldOne/src/fetcher/wrapper.py
import sys
# 只读引用DSA数据源代码，不修改
DSA_PATH = "/Users/z/daily-stock-analysis-phase2c-round5"
if DSA_PATH not in sys.path:
    sys.path.insert(0, DSA_PATH)

from data_provider.base import (
    DataFetcherManager, BaseFetcher, STANDARD_COLUMNS,
    normalize_stock_code, is_bse_code, is_st_stock, is_kc_cy_stock
)
from data_provider.realtime_types import UnifiedRealtimeQuote, RealtimeSource
from data_provider.tushare_fetcher import TushareFetcher
from data_provider.hithink_ashare_fetcher import HithinkAshareFetcher
# ... 其他fetcher按需引用
```

**原则**：
- 仅 `import` 使用，绝不修改DSA源码
- DSA配置文件(`.env`)不读取，GoldOne用独立 `.env.goldone`
- 共享的只有**代码逻辑**，不共享**运行时状态/连接/缓存/数据库**

### 3.3 数据访问边界

| 资源 | DSA | GoldOne | 访问方式 |
|------|-----|---------|---------|
| `stock_analysis.db` | 拥有者/写入者 | **只读查询** | `sqlite3` 只读连接 或 导出CSV后导入 |
| `data_provider/*` 代码 | 拥有者 | **只读引用** | `sys.path` import |
| hithink-finance CLI | 共用安装 | 共用安装 | 独立进程调用，独立数据目录(`--db`) |
| Tushare Token | 配置在DSA `.env` | **独立配置** | GoldOne `.env.goldone` 自行配置(可复用同Token) |
| 实时双源Bridge | DSA部署/运行 | **自建或复用** | GoldOne自建HTTP服务 或 配置指向DSA实例(只读) |

---

## 4. 预计技术工作量汇总

| 阶段 | 任务 | 工时 | 备注 |
|------|------|------|------|
| **Phase 0: 环境就绪** | 安装依赖、配置API Key、验证hithink CLI | 4h | 一次性 |
| **Phase 1: 历史全量回补** | `data init` + 校验 + 导入GoldOne DuckDB | 24h | 含下载等待 |
| **Phase 2: 基础设施建设** | 项目脚手架、存储层、配置管理 | 20h | 核心工程 |
| **Phase 3: 管线开发** | 全量/增量同步、质量门禁、导出 | 40h | 核心工程 |
| **Phase 4: 研究能力** | 时点重建、面板构建、因子接口 | 40h | 研究核心 |
| **Phase 5: 验收与文档** | 跨源校验、2026-11-04时点验证、文档 | 16h | 交付验收 |
| **合计** | | **~144h** (约 3-4 周单人) | 含缓冲 |

> 注：若团队并行或复用现有DSA管线组件，可压缩至 **2周内**。

---

## 5. 可能产生的授权或费用

| 项目 | 费用模式 | 预估成本 | 必选性 |
|------|---------|---------|--------|
| **hithink-finance 统一API Key** | 注册免费，按调用量/数据量计费 | 免费额度通常够历史回补；增量极低成本 | ✅ **必选** |
| **Tushare Pro 积分** | 积分制(注册送~120分，1200分≈全市场一日线) | 如需高频/全量历史：¥500-2000/年 | ⚠️ 备用源建议购买 |
| **Yfinance / AlphaVantage / Finnhub** | 免费额度 / 付费升级 | 免费额度通常足够全球指数 | ✅ 免费可用 |
| **服务器/存储** | 本地开发机无成本；云部署按需 | 本地SSD建议≥500GB空闲 | ✅ 本地即可 |
| **hithink-finance Bridge 服务** | 需自行部署两个HTTP服务(Go/Python) | 开发运维成本 | ✅ 实时双源必需 |

**费用结论**：**核心历史数据建设可在"零额外采购成本"下完成**(hithink免费额度+Yfinance免费)。Tushare积分作为备用/补充源建议少量购买以提高鲁棒性。

---

## 6. 下一步开发优先级 (G002 进入条件)

### 6.1 必须完成 (G001 验收门禁)

- [x] 真实仓库识别确认
- [x] 数据源可调用性审计完成
- [x] 数据覆盖率量化分析完成
- [x] 2026-11-04 时点重建能力评估完成
- [x] 三份审计报告生成

### 6.2 G002 启动前置条件 (GoldOne研究大脑审核通过后)

| 优先级 | 任务 | 产出物 |
|--------|------|--------|
| **P0** | 申请/确认 hithink-finance API Key 额度 | Key配入 `.env.goldone` |
| **P0** | 执行 `hithink-finance data init --yes` 全量初始化 | 本地DuckDB含2015-2026全数据 |
| **P0** | 验证本地数据完整性：股票数/日期范围/复权因子/公告日 | `data validate` 通过 |
| **P1** | 搭建 GoldOne 独立项目脚手架 | 可运行的 `sync_history.py` |
| **P1** | 实现历史数据导入 GoldOne DuckDB + Parquet 导出 | `goldone.duckdb` + `parquet/daily/` |
| **P1** | 建立时点合规重建器原型：输入日期 → 输出当时可知面板 | `point_in_time.rebuild(date)` |
| **P2** | 2026-11-04 多时点重建验证 (09:30/10:30/14:00/15:00/15:30) | 验证报告 |
| **P2** | 跨源抽样校验：hithink vs Tushare(若可用) 价格/基本面一致性 | 校验报告 |

### 6.3 G002 核心交付目标

> **GoldOne 拥有 2015-2026 全周期、防未来泄漏、可复现的历史研究数据湖，能准确还原任意历史时点(如2026-11-04)的已知信息集。**

---

## 7. 风险与对策

| 风险 | 可能性 | 影响 | 对策 |
|------|--------|------|------|
| hithink-finance 历史数据下载失败/不全 | 中 | 高 | 分批重试；备用Tushare Pro补充；人工核对关键指数 |
| Tushare 积分不足无法全市场回补 | 高 | 中 | 优先用hithink主源；Tushare仅作关键指数/基本面补充 |
| 复权因子跨源不一致导致收益率偏差 | 中 | 高 | 统一以hithink `calc_adjust_factor_daily` 为准；Tushare仅校验 |
| 实时双源Bridge服务不可用/不稳定 | 中 | 高 | 先用腾讯/新浪单源兜底；Bridge部署纳入GoldOne基建 |
| 基本面公告日期缺失导致回测合规风险 | 低(同花顺通常含) | 极高 | 验证阶段重点抽查；缺失则标记不可用、不参与回测 |
| 2015-2020早期数据在源端缺失/错误 | 低 | 中 | 标记数据质量等级；研究时按可用区间分段 |

---

## 8. 附录：关键命令速查

```bash
# 1. 验证 hithink-finance 环境
hithink-finance auth status --format json
hithink-finance capabilities --format json

# 2. 全量历史初始化 (预计 30-60 分钟，需稳定网络)
hithink-finance data init --yes

# 3. 增量同步 (每日收盘后运行)
hithink-finance data sync

# 4. 质量校验
hithink-finance data validate

# 5. 本地查询示例
hithink-finance db query --sql "SELECT * FROM v_daily_qfq WHERE thscode='300274.SZ' AND date>='2026-11-01' ORDER BY date"
hithink-finance db export --sql "SELECT * FROM v_daily_qfq WHERE date>='2015-01-01'" --output goldone_daily.parquet

# 6. 指数历史
hithink-finance index history --thscode 000852.SH --start 2015-01-01 --end 2026-11-10 --output csi1000.parquet

# 7. 基本面 (含公告日)
hithink-finance financials income --thscode 300274.SZ --start 2015-01-01 --end 2026-11-10 --output income_300274.parquet
```

---

**方案状态**：待 GoldOne 研究大脑审核通过后执行
**决策依据**：本方案基于完整的仓库审计、数据覆盖量化分析、跨源可行性评估
**审批流程**：GoldOne 研究大脑审核 → 确认数据可靠/覆盖充足/无偏差泄漏 → 批准进入 G002

---

**报告生成时间**：2026-11-10
**编制人**：Kilo (自动化分析)