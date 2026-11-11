# GoldOne_G001_RC 可复现证据索引

**任务编号**: GoldOne-G001-RC
**执行日期**: 2026-11-11 (RC2 更新)
**用途**: 汇总本轮 RC 及历史 RB 阶段所有可复现证据，按证据类型分类

---

## 1. 脱敏原始响应证据

### 1.1 Tushare 接口实测 (jiaoch.top endpoint)

| 接口 | 请求参数 | 响应摘要 (脱敏) | 存储位置 | 可复现性 |
|------|----------|----------------|----------|----------|
| daily | ts_code=300274.SZ, start_date=20240102, end_date=20240102 | `vol=134018.07, amount=1153503.411, close=85.4, open=87.5, high=87.6, low=85.23` | RC 报告 §1.1 | ✅ `curl -s -X POST "https://jiaoch.top/" -d '{"api_name":"daily","token":"b00a...","params":{"ts_code":"300274.SZ","start_date":"20240102","end_date":"20240102"}}'` |
| adj_factor | ts_code=300274.SZ, start_date=20240102, end_date=20240102 | `adj_factor=6.806` | RC 报告 §2.1 | ✅ 同上 |
| adj_factor (最新) | ts_code=300274.SZ, start_date=20261101, end_date=20261110 | `adj_factor=9.943` | RC 报告 §2.2 | ✅ 同上 |
| index_daily | ts_code=399006.SZ, start_date=20240102, end_date=20240102 | `close=1855.92, open=1889.02, high=1889.02, low=1855.73, vol=12188528.91, amount=42670856.20` | RC 报告 §1.1 | ✅ 同上 |

### 1.2 hithink-finance CLI 实测

| 命令 | 响应摘要 (脱敏) | 存储位置 | 可复现性 |
|------|----------------|----------|----------|
| `market history --thscode 300274.SZ --start-ms 1704067200000 --end-ms 1704153600000 --adjust forward` | `volume=18762529.8, turnover=1153503411.49, close_price=56.9507, open_price=58.4507, adjust=forward` | RC 报告 §1.1 | ✅ `hithink-finance market history --thscode 300274.SZ --start-ms 1704067200000 --end-ms 1704153600000 --adjust forward --format json` |
| `index history --thscode 399006.SZ --start-ms 1704067200000 --end-ms 1704153600000` | `volume=11595394600, turnover=179336680000, close_price=1855.92, adjust=null` | RC 报告 §1.1 | ✅ 同上 |
| `auth status --format json` | `configured: true, method: api-key, profile: default` | 能力验证报告 | ✅ `hithink-finance auth status --format json` |
| `db query --sql "SELECT * FROM calc_adjust_factor_daily WHERE thscode='300274.SZ'"` | `data: []` (空表) | RC 报告 §2.2 | ✅ 本地库为空，预期 |

### 1.3 ashare-bridge 实测 (localhost:8000)

| 接口 | 响应摘要 (脱敏) | 存储位置 | 可复现性 |
|------|----------------|----------|----------|
| `GET /daily/300274?upstream=sina&trade_date=20240102` | `fields: {open:"87.5", high:"87.6", low:"85.23", close:"85.4", volume:"13401807.0"}, amount: null, adjustment_mode: "unknown"` | RC 报告 §1.1 | ✅ `curl http://127.0.0.1:8000/daily/300274?upstream=sina&trade_date=20240102` |
| `GET /quote/300274` | `day_volume: 591183.0, price: 79.6, vwap_proxy: 78.934, change_pct: 2.25` | RC 报告 §1.1 | ✅ `curl http://127.0.0.1:8000/quote/300274` |
| `GET /bars/300274` | 240 根 1m K线，`volume` 单位手，`price` 单位元 | RC 报告 §1.1 | ✅ `curl http://127.0.0.1:8000/bars/300274` |
| `GET /health` | `{"source":"Ashare","status":"ok","version":"V3.1-Mac"}` | 能力验证报告 | ✅ `curl http://127.0.0.1:8000/health` |

### 1.4 hithink-bridge 实测 (localhost:8100)

| 接口 | 响应摘要 (脱敏) | 存储位置 | 可复现性 |
|------|----------------|----------|----------|
| `GET /quote/300274` | `last_price: 79.6, volume: 59793359(股), turnover: 4719700100(元), open_price: 78.94, high_price: 80.1, low_price: 77.22` | RC 报告 §1.1 | ✅ `curl http://127.0.0.1:8100/quote/300274` |
| `GET /health` | `status: ok, hithink: {auth: {configured: true}}, source: 同花顺` | 能力验证报告 | ✅ `curl http://127.0.0.1:8100/health` |

---

## 2. 完整命令及退出状态

| 命令 | 退出状态 | 测试目的 | 执行轮次 |
|------|----------|----------|----------|
| `hithink-finance auth status --format json` | 0 | CLI 认证 | RB |
| `hithink-finance market history --thscode 300274.SZ --start-ms 1704067200000 --end-ms 1706745600000 --adjust forward` | 0 | 2024-01 历史日线 | RB |
| `hithink-finance market history --thscode 300274.SZ --start-ms 1514764800000 --end-ms 1546300800000 --adjust forward` | 0 | 2018 全年历史 | RB |
| `hithink-finance index history --thscode 399006.SZ --start-ms 1704067200000 --end-ms 1704153600000` | 0 | 指数日线 | RC |
| `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health` | 0, HTTP 200 | ashare-bridge 运行 | RB+RC |
| `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8100/health` | 0, HTTP 200 | hithink-bridge 运行 | RB+RC |
| `python3 /Users/z/GoldOne/tests/test_g002a_schema.py` | 0 | G002A Schema 内存验证 | RC |
| `curl -s -X POST "https://jiaoch.top/" (daily test)` | 0, HTTP 200 | Tushare 连通性 | RC |

---

## 3. 可复现只读测试程序

| 测试程序 | 路径 | 测试范围 | 依赖 | 是否可独立运行 |
|----------|------|----------|------|---------------|
| Schema 验证 | `/Users/z/GoldOne/tests/test_g002a_schema.py` | 8 表创建 + 正向/负向 37 断言 | Python + duckdb 2.0.0 | ✅ `.venv` 独立运行, 退出码 0 |
| Ashare /daily 新样本 | `/Users/z/GoldOne/docs/G001/GoldOne_G001_RC2_残余问题整改报告.md` §1.2 | 3 股票 × 3 交易日, 逐接口单位判定 | ashare-bridge | ✅ 9 个 curl |
| 符号搜索验证 | RB 阶段已定制 | hithink-finance symbol.search + list | CLI v0.1.5 | ✅ |
| 复权计算验证 | RC 报告 §2.2 公式 | Tushare adj_factor 前复权计算 | Tushare 端点 | ✅ 公式可离线验证 |

---

## 4. 对应代码路径和行号

| 功能 | 项目 | 文件 | 关键行号 | 说明 |
|------|------|------|----------|------|
| Tushare daily 接口 | DSA (只读) | `data_provider/tushare_fetcher.py` | ~770-774 | vol×100 (手→股), amount×1000 (千元→元) |
| Tushare 端点策略 | DSA (只读) | `data_provider/tushare_endpoint_policy.py` | 全域 | HTTPS 强制、窗口治理 |
| Ashare.py 新浪日线 | ashare-bridge (只读) | `server.py` (Ashare.py 导入) | `/daily` 路由 | Sina 门控四重校验 |
| Ashare.py 腾讯分时 | ashare-bridge (只读) | `Ashare.py` | `get_price_min_tx` | 1m K线腾讯源 |
| hithink-bridge 代码归一化 | hithink-bridge (只读) | `server.py` | `normalize_code` | 6位→thscode 转换 |
| DataProvider 统一接口 | DSA (只读) | `data_provider/base.py` | 全域 | 路由/熔断/降级 |

---

## 5. 证据类型分级说明

| 证据等级 | 含义 | 本轮证据数量 | 示例 |
|----------|------|-------------|------|
| **A级: 实测响应 (脱敏)** | 本轮运行真实 API 返回的原始数据 | 8 | Tushare daily, hithink-finance history, Bridge 接口 |
| **B级: 命令+退出码** | CLI 命令执行结果，含退出状态 | 7 | `curl` health check, `hithink-finance` 命令 |
| **C级: 可复现测试程序** | 可独立运行并复现的测试脚本 | 1 | `test_g002a_schema.py` |
| **D级: 代码逻辑引用** | 引用代码路径和行号，非本轮运行 | 5 | `tushare_fetcher.py:770`, `base.py` 引用 |
| **E级: 历史报告曾测试成功** | RB 阶段执行，非本轮 | 10+ | RB 阶段 S1-S10 样本，本报告不重复引用 |

**重要区分**：
- **本轮实测 (A/B/C 级)** = 当前 RC 任务实际执行获取
- **RB 阶段遗留证据 (E 级)** = 上一轮 RB 任务执行，本轮不做重复验证

---

## 6. 证据到报告交叉引用

| RC 报告 | 主要证据编号 (本索引) |
|---------|----------------------|
| 安全整改报告 | 1.2 (auth status), 完整命令 §2 |
| 数据单位与复权复核报告 | 1.1 (Tushare daily), 1.1 (hithink history), 1.3 (ashare daily), 完整命令 §2 |
| 历史时点重建复核报告 | 1.1 (Tushare index_daily), 1.2 (hithink index history) |
| G002A Schema修订报告 | 测试程序 §3, 完整命令 §2 (test_g002a_schema.py) |
| **RC2 残余问题整改报告** | **1.3 (ashare 三接口新样本), 完整命令 §2 (curls), 测试程序 §3 (test RC2)** |

---

**报告生成时间**: 2026-11-10
**执行 AI**: Kilo