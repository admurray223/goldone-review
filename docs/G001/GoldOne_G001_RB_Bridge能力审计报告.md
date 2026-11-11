# GoldOne_G001_RB Bridge能力审计报告

**任务编号**: GoldOne-G001-RB
**执行日期**: 2026-11-10
**审计范围**: hithink-bridge, ashare-bridge

---

## 1. hithink-bridge 审计

### 1.1 项目基本信息

| 项目 | 详情 |
|------|------|
| 路径 | /Users/z/hithink-bridge |
| 端口 | 8100 |
| 运行状态 | ✅ 运行中 (Flask) |
| 启动方式 | `python3 server.py` (单进程) |
| 核心依赖 | Flask, hithink-finance CLI (/Users/z/.local/bin/hithink-finance) |
| Python 环境 | 系统 Python + .venv |

### 1.2 技术架构

```
Client -> Flask (port 8100) -> subprocess.run(hithink-finance CLI) -> 同花顺远程 API -> JSON响应
```

- **架构模式**: 同步阻塞式 CLI 封装
- **超时设置**: 20 秒 (subprocess timeout)
- **输出格式**: 统一 JSON，含 schema_version, timestamp_contract

### 1.3 API 接口清单

| 接口 | 方法 | 参数 | 返回示例 | 说明 |
|------|------|------|----------|------|
| `/` | GET | 无 | status, version, examples | 服务信息 |
| `/health` | GET | 无 | hithink auth status, server_time | 健康检查含上游认证 |
| `/quote/<code>` | GET | code (6位数字) | snapshot数据, thscode, timestamp_contract | 单只实时快照 |
| `/batch` | GET | codes (逗号分隔, ≤30) | 批量快照, count, thscodes | 批量实时快照 |

### 1.4 代码规范化逻辑 (`normalize_code`)

```python
# 输入: 6位纯数字代码
# 输出: thscode 格式
60xxxx, 68xxxx -> xx.SH (主板/科创板)
00xxxx, 30xxxx -> xx.SZ (主板/创业板)
4xxxx, 8xxxx, 9xxxx -> xx.BJ (北交所)
其他 -> None
```

### 1.5 数据能力验证

| 能力项 | 实测结果 | 说明 |
|--------|----------|------|
| 实时快照 | ✅ 正常 | 300274.SZ 返回 last_price, volume, turnover 等 |
| 批量查询 | ✅ 正常 | 最多 30 只/次 |
| 历史日线 | ❌ 不支持 | 无历史接口，仅实时快照 |
| 分钟线 | ❌ 不支持 | 无分钟线接口 |
| 复权行情 | ❌ 不支持 | 仅返回当前快照价格 |
| 公司行为 | ❌ 不支持 | 无分红/拆股数据 |
| 财务数据 | ❌ 不支持 | 无财务接口 |
| 指数数据 | ❌ 不支持 | 仅个股 |
| 代码覆盖 | ✅ 全市场 | 支持 SH/SZ/BJ 所有 A 股代码格式 |
| 调用限制 | CLI 限制 | 受 hithink-finance CLI 远程配额限制 |
| 缓存机制 | 无本地缓存 | 每次请求直连 CLI |

### 1.6 实测样本

**请求**: `GET /quote/300274`
**响应关键字段**:
```json
{
  "code": "300274",
  "thscode": "300274.SZ",
  "result": {
    "ok": true,
    "data": {
      "item": [{
        "thscode": "300274.SZ",
        "ticker": "300274",
        "last_price": 79.6,
        "open_price": 78.94,
        "high_price": 80.1,
        "low_price": 77.22,
        "prev_price": 77.85,
        "volume": 59793359,
        "turnover": 4719700100,
        "price_change": 1.75,
        "price_change_ratio_pct": 2.247913
      }],
      "timestamp": 1794320397000
    }
  },
  "timestamp_contract": {
    "event_time": null,
    "event_time_semantics": "unknown",
    "server_time": "2026-11-10T14:19:58.147111+00:00"
  }
}
```

---

## 2. ashare-bridge 审计

### 2.1 项目基本信息

| 项目 | 详情 |
|------|------|
| 路径 | /Users/z/ashare-bridge |
| 端口 | 8000 |
| 运行状态 | ✅ 运行中 (Flask) |
| 启动方式 | `python3 server.py` (单进程) |
| 核心依赖 | Flask, Ashare.py (自带), pandas, requests |
| 数据来源 | **双核心**: 腾讯 + 新浪财经 |

### 2.2 底层数据来源确认

**Ashare.py 双核心实现**:

| 函数 | 数据源 | 接口 URL | 用途 |
|------|--------|----------|------|
| `get_price_day_tx` | **腾讯** | `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get` | 日/周/月线 (前复权 qfq) |
| `get_price_min_tx` | **腾讯** | `http://ifzq.gtimg.cn/appstock/app/kline/mkline` | 分钟线 (含实时 qt 价格) |
| `get_price_sina` | **新浪** | `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` | 全周期 (含日线) |
| `get_price` | 统一入口 | 自动 fallback | 对外唯一函数 |

**关键确认**: 
- ❌ **非 Akshare** - 代码中无 akshare 导入或调用
- ✅ **Ashare (mpquant/Ashare fork)** - 直接 HTTP 请求腾讯/新浪接口
- ✅ **新浪传输为 HTTPS** - 冻结配置 `sina-https-v1`，TLS 验证、禁止重定向、超时 (10,15)

### 2.3 API 接口清单

| 接口 | 方法 | 参数 | 返回示例 | 说明 |
|------|------|------|----------|------|
| `/` | GET | 无 | status, version, examples | 服务信息 |
| `/health` | GET | 无 | status, version, time | 简单健康检查 |
| `/quote/<code>` | GET | code (6位) | 实时摘要含 1m/1d 数据 | 综合实时行情 |
| `/batch` | GET | codes (≤30) | 批量 quote | 批量实时 |
| `/watchlist` | GET | 无 | watchlist.json 全量 quote | 自选股监控 |
| `/bars/<code>` | GET | code (6位) | 240 根 1m K线 | 分钟线历史 |
| `/daily/<code>` | GET | code, upstream=sina, trade_date | 单日日线 (严格校验) | **显式历史日线** |

### 2.4 代码规范化逻辑 (`code_to_symbol`)

```python
# 输入: 6位纯数字代码
# 输出: 腾讯/新浪 symbol 格式
60xxxx, 68xxxx -> shxxxxxx
00xxxx, 30xxxx -> szxxxxxx
4xxxx, 8xxxx, 9xxxx -> bjxxxxxx
```

### 2.5 `/daily` 接口严格约束 (MDS-1 合规)

```python
# 必需参数
upstream: "sina" (仅支持确切小写 "sina")
trade_date: "YYYYMMDD" (8位数字+合法日期)

# 运行时门控 (需环境变量)
ASHARE_SINA_RUNTIME_ENABLED=true

# 传输门控 (四重校验)
1. 运行时开关 == true
2. SINA_TRANSPORT_STATUS == "HTTPS"
3. sina_https_profile_is_valid() == True
4. 冻结常量匹配: version, TLS_VERIFY, ALLOW_REDIRECTS, TIMEOUT

# 失败即失败，无 fallback
```

### 2.6 数据能力验证

| 能力项 | 实测结果 | 说明 |
|--------|----------|------|
| 实时快照 | ✅ 正常 | /quote 返回 price, change_pct, day_ohlcv, volume, vwap 等 |
| 分钟线 | ✅ 正常 | /bars 返回 240 根 1m K线 (腾讯) |
| 历史日线 | ✅ 正常 | /daily?upstream=sina&trade_date=20240102 返回 OHLCV |
| 复权行情 | ⚠️ 部分 | 腾讯日线为 qfq (前复权)；新浪日线 adjustment_mode=unknown |
| 公司行为 | ❌ 不支持 | 无分红/拆股专用接口 |
| 财务数据 | ❌ 不支持 | 无财务接口 |
| 指数数据 | ✅ 支持 | 000001/399001/399006 等通过 code_to_symbol |
| 代码覆盖 | ✅ 全市场 | SH/SZ/BJ A股 + 指数 |
| 调用限制 | 目标站限制 | 腾讯/新浪公共接口，无显式配额 |
| 缓存机制 | 无本地缓存 | 每次请求直连上游 |
| 数据单位 | 明确标注 | volume 为"手"(×100=股)，amount 为"千元"(×1000=元) |

### 2.7 实测样本

**请求**: `GET /quote/300274`
```json
{
  "code": "300274",
  "symbol": "sz300274",
  "name": "阳光电源",
  "price": 79.6,
  "prev_close": 77.85,
  "change_pct": 2.25,
  "day_open": 78.94,
  "day_high": 80.05,
  "day_low": 77.23,
  "day_volume": 591183.0,
  "vwap_proxy": 78.934
}
```

**请求**: `GET /daily/300274?upstream=sina&trade_date=20240102`
```json
{
  "code": "300274",
  "exchange": "SZ",
  "trade_date": "20240102",
  "fields": {
    "open": "87.5",
    "high": "87.6",
    "low": "85.23",
    "close": "85.4",
    "volume": "13401807.0"
  },
  "adjustment_mode": "unknown",
  "numeric_provenance": "float_coerced_by_ashare"
}
```

---

## 3. 两 Bridge 协同能力分析

### 3.1 接口重叠度

| 数据类型 | hithink-bridge | ashare-bridge | 重叠 |
|----------|----------------|---------------|------|
| 实时快照 | ✅ | ✅ | **高** |
| 批量实时 | ✅ | ✅ | **高** |
| 分钟线 | ❌ | ✅ | 无 |
| 历史日线 | ❌ | ✅ (显式) | 无 |
| 复权因子 | ❌ | ⚠️ (腾讯qfq) | 无 |
| 财务数据 | ❌ | ❌ | 无 |
| 指数行情 | ❌ | ✅ | 无 |

### 3.2 底层数据源独立性

| 维度 | hithink-bridge | ashare-bridge | 独立性结论 |
|------|----------------|---------------|------------|
| 数据供应商 | **同花顺 (核新/同花顺自有)** | **腾讯 + 新浪财经** | **完全独立** |
| 传输协议 | CLI -> 远程 API (HTTPS) | 直连 HTTP/HTTPS | 独立 |
| 认证方式 | API Key (hithink-finance) | 无需认证 (公共接口) | 独立 |
| 价格口径 | 同花顺实时价 | 腾讯 qt 价/新浪收盘价 | 可能差异 |
| 成交量单位 | 股 (原始) | 手 (×100=股) | **单位不同** |
| 复权口径 | 未知 (快照无复权) | 腾讯 qfq / 新浪 unknown | 不一致 |

### 3.3 运行时独立性

| 项目 | 结论 |
|------|------|
| 进程隔离 | ✅ 两端口独立 Flask 进程 |
| 依赖隔离 | ✅ hithink-bridge 依赖 hithink-finance CLI；ashare-bridge 依赖 requests/pandas |
| 配置隔离 | ✅ 无共享配置文件 |
| 单点故障 | ✅ 任一挂掉不影响另一 |
| DSA 依赖 | ✅ 无需 DSA 进程运行 |

### 3.4 切换与交叉验证策略

| 场景 | 推荐主源 | 交叉验证源 | 理由 |
|------|----------|------------|------|
| 实时快照 | hithink-bridge | ashare-bridge | 同花顺专业级，腾讯作验证 |
| 分钟线历史 | ashare-bridge | (无) | 仅 ashare 有 |
| 日线历史 | ashare-bridge (/daily) | hithink-finance CLI | 显式新浪源，可对比 CLI |
| 复权价格 | hithink-finance CLI | ashare-bridge (腾讯qfq) | CLI 支持 forward/backward |
| 指数行情 | ashare-bridge | hithink-finance CLI | 两者均支持 |

---

## 4. GoldOne 复用建议

### 4.1 访问方式

```python
# hithink-bridge
import requests
r = requests.get("http://127.0.0.1:8100/quote/300274")

# ashare-bridge
r = requests.get("http://127.0.0.1:8000/quote/300274")
r = requests.get("http://127.0.0.1:8000/daily/300274?upstream=sina&trade_date=20240102")
```

### 4.2 注意事项

1. **单位换算**: ashare-bridge volume 为"手"，需 ×100 转股；amount 为"千元"，需 ×1000 转元
2. **复权口径**: 两 Bridge 复权不一致，历史回测建议用 hithink-finance CLI 或 Tushare
3. **调用频率**: 实时接口建议 ≥1min 间隔，避免触发上游限流
4. **Sina 门控**: ashare-bridge /daily 需 `export ASHARE_SINA_RUNTIME_ENABLED=true`
5. **时间语义**: 两 Bridge 均返回 `event_time: null`，server_time 为桥接器响应时间，非行情事件时间

---

## 5. 结论

| 审计项 | hithink-bridge | ashare-bridge |
|--------|----------------|---------------|
| 服务可用性 | ✅ 运行中 | ✅ 运行中 |
| 接口完整性 | 实时仅快照 | 实时+分钟+显式日线 |
| 历史数据 | ❌ 无 | ✅ 日线/分钟线 |
| 数据源独立性 | ✅ 同花顺 | ✅ 腾讯+新浪 |
| 生产就绪度 | 高 (实时监控) | 高 (实时+历史) |
| 推荐用途 | 实时主源 | 历史回测辅源+交叉验证 |

**核心发现**: 两 Bridge 底层数据源**完全独立** (同花顺 vs 腾讯/新浪)，可作为互补的交叉验证来源。ashare-bridge 因支持显式历史日线和分钟线，更适合作为 GoldOne 历史数据获取的辅助来源；hithink-bridge 配合 hithink-finance CLI 更适合作为实时主源和深度历史数据源。

---

**报告生成时间**: 2026-11-10 22:45:00
**执行 AI**: Kilo