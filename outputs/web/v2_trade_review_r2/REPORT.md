# GO-Web-V2-R2 交易展示统一修订、评分方向审计与同址发布报告

- 任务：`GO-Web-V2-R2`——交易展示统一修订、评分方向审计与同址发布
- 状态：**COMPLETED（展示修复、评分方向审计、四宽度本地+公网验证、同址发布、公网哈希核对均完成）**
- 建议 Decision：**展示修复 ACCEPT；评分方向问题 CONFIRMED（本轮只审计，未改策略，留待下一任务修复）**
- 日期：2026-11-23
- 仓库：`/Users/z/GoldOne`（`admurray223/goldone-review`）
- 分支：`master`
- 基线 HEAD：`9b87e9f32c8ab2affd7fe151ad26811a510e5348`（P21-R1 校验记录提交）
- 站点修复提交：`5de4b5c`（`V2 trade review R2: trade stats, period-end holdings, buy/sell dates, three-trade notes, scoring audit, red-up/green-down`）
- 公网地址：https://admurray223.github.io/goldone-review/
- 报告路径：`/Users/z/GoldOne/outputs/web/v2_trade_review_r2/REPORT.md`
- 授权范围：仅修改必要展示代码（`app.js`、`styles.css`）、P21 维护源（`outputs/web/v2_frozen_review/site/`）及从冻结记录派生的展示数据（新增 `data/v2_trade_notes.json`）；评分方向仅审计。不改策略、研究数据、交易、数据库、历史收益；不取新金融数据；不调参；不启动自动任务/模拟盘/实盘。

## 1. 一句话结论

在不改策略与历史收益的前提下，给 V2 总览与交易页补齐了“买入/卖出/成交总笔数、区间结束日期、期末持仓股票数、可展开期末持仓明细”，把交易表改为“买入成交日 / 卖出成交日 / 卖出信号日”分列并对未平仓标注“尚未卖出”，新增新阶段三笔成交的可展开解释与评分方向审计卡；全站统一为红涨绿跌。四宽度本地与公网浏览器验证 **44/44**、专项 **20/20**、公网文件哈希 **36/36**、V2 数据契约 **61/61** 全部通过。评分方向审计确认存在“上涨更易触发风险卖出”的方向冲突（确定性实现问题 + 策略定义问题），本轮未改任何评分/阈值/符号，留待下一任务。

## 2. 原发布成功项、本轮修复项、实际失败项

| 分类 | 内容 | 证据 |
|---|---|---|
| 原发布已有成功项 | V2 四页、V1 四组实验、时间区间、交易筛选排序、意见存储、390 移动布局、P21 导航修复 | P21-R1 报告；本轮回归 `nav_*_all_reachable` 17/17×4 宽度 |
| 本轮新增/修复项 | 成交统计（买/卖/合计/结束日/期末持仓数）；期末持仓明细；买入/卖出日期分列；未平仓“尚未卖出”；新阶段三笔成交解释；评分方向审计卡；红涨绿跌 | `verification/local_full_results.json`、`public_full_results.json`、`browser_check` 结果 |
| 本轮实际失败项 | **0** | 本地 44/44、公网 44/44、专项 20/20、哈希 36/36、契约 61/61 |

## 3. 展示修复设计（对应任务三、四、五、七）

### 3.1 成交统计与期末持仓（任务三）
- 新增 `v2StatsBlock()`，在 V2 总览与 V2 交易页顶部显示：买入成交笔数、卖出成交笔数、成交总笔数、区间结束日期、期末持仓股票数、持仓周期数（当前区间）。
- 口径区分：**成交笔数**（买/卖实际成交，不含信号/挂单/取消）、**持仓周期数**（闭合周期 + 期末未平仓）、**期末持仓数**（区间结束日快照）。
- 期末持仓由**区间结束日**的 timeline 事件（buy−sell 累计）推导，**不把 7-29 的 1 只持仓沿用为 11-19 状态**。可展开“期末持仓明细”。
- 基准核对（全部 PASS）：A 开发 `19/18/37/1`、A 新 `1/2/3/0`、A 全窗口 `20/20/40/0`、C 全窗口 `18/18/36/0`；C 开发 `17/17/34/0`、C 新 `1/1/2/0`。

### 3.2 明确买卖日期（任务四）
- “成交与持仓周期”表与“卖出明细”表均分列：**股票、操作/状态、买入成交日、卖出成交日、卖出信号日、持有交易日、净盈亏、净收益率**。
- 未平仓显示“尚未卖出”，**不用期末日期冒充卖出日期**。
- 本数据集每笔卖出对应单一买入批次（`matched_lots` 均为 1 条），按实际匹配记录展示；无多批次买入/部分卖出。
- 买入行关联的后来卖出日属事后展示，页面已注明不进入策略输入。
- 日期筛选标明“按卖出成交日（fill_date）筛选”；筛选后记录数与区间成交总数分列显示。

### 3.3 新阶段三笔成交解释（任务五）
- 新增 `v2TradeNotesCards()`，从冻结 P20E prefix（orders + review_cycles）派生，展示：
  1. 688009.SH 中国通号：2026-08-10 信号 → 08-11 买入 33,800 股；真实未复权开盘 4.97、滑点后 4.97497、费用 43.72、总成本 168,197.71；市场 normal / 板块 healthy / 价格 neutral / 财务 passed。
  2. 605138.SH 盛泰集团：原买入 2026-07-13；10-12 卖出信号 → 10-13 卖出 28,900 股；开盘 6.05、卖出价 6.04395、费用 220.09、净回款 174,450.07；触发 `sector_risk_change`，market+sector，剩余 stock=6.331115≥5。
  3. 688009.SH 中国通号：10-14 卖出信号 → 10-15 卖出 33,800 股；开盘 4.91、卖出价 4.90509、费用 208.90、净回款 165,583.14；触发 scheduled+sector，market+sector，剩余 stock=5.0≥5。
- 每笔含：信号日/成交日、数量与预算依据、真实开盘价/滑点价/费用、买卖条件、卖出触发维度/评分/公式/原始输入。
- **无法重建**明确标注：财务报告期与逐项门禁值（`fin.gate_evaluation` 为空，只能确认 financial_state=passed）、逐条观察流水。
- 页面注明模拟时序：收盘形成信号、下一交易日开盘成交；买入价=开盘×(1+0.1%)、卖出价=开盘×0.999 另计费用；**回测假设，不保证真实可成交**。研究代理不写成真实资金流/大单承接。

### 3.4 红涨绿跌（任务七）
- 集中定义 `--color-up`（红）/ `--color-down`（绿）/ `--color-neutral`（灰），翻转 `.positive`/`.negative`/`td.positive`/`td.negative`/`span.positive`/`span.negative`/`.metric-delta.*`，并新增 `.neutral`。
- 正值红、负值绿、零/缺失中性；`v2SignedPct` 为百分比补 `+` 号，保留正负号与文字，不仅靠颜色。
- 贡献柱状图正/负也改为红/绿；买卖操作标签与涨跌颜色语义分开；方案折线颜色（区分实验）未强行套用涨跌含义。

## 4. 评分方向专项审计（任务六，只读）

### 4.1 实际调用链
- `src/strategies/v2/p7_r1_research_runner.py::_proxy_scores`：`scores["market"]=clamp(5+market_mom*100)`、`scores["sector"]=clamp(5+sector_ret*100)`、`scores["stock"]=clamp(5+stock_mom20*100)`；缺失时排序路径回退 `5.0`。
- `src/strategies/v2/decision.py`：两个维度 `TRIGGERED` 后，取剩余维度 `remaining_score`，`>= third_score_threshold(5.0)` 即 `EXIT_SIGNAL`（`two_triggered_remaining_score_ge_threshold`）。

### 4.2 结论
- **三项分数实为“动量/强弱”分**：5 为中性，>5 上涨动能、<5 下跌动能；**不是“风险分”**。设计草案 `docs/strategy_v2/scoring_draft.md` 把 0-10 定义为风险（0=极低风险、10=极高风险），两者方向相反。
- **方向冲突确认**：退出要求剩余维度分 ≥5，而分数=5+动量×100，于是**上涨/走强更易满足 ≥5 触发风险卖出，下跌/走弱反而降低分数难以触发**，与“风险越高越应卖出”相反。
- **盛泰 6.331115**：stock_mom20=(6.331115−5)/100=**+1.331115%**；market=0.0（大盘动量≤−5%）、sector=2.231116（板块 1 日 −2.77%）。
- **中国通号 5.0**：stock_mom20=(5.0−5)/100=**0.0%**；注意 5.0 恰等于阈值，且等于缺失数据在排序路径的默认值 5.0，需核实是真实 0% 动量还是缺失默认值。

### 4.3 分类与影响
- **确定性实现问题**：公式 `clamp(5+动量×100)` 是动量/强弱分，而退出阈值 ≥5 与设计草案风险语义相反，导致上涨更易触发风险卖出；缺失数据回退 5.0 可能让缺失值恰好通过 ≥5。
- **策略定义问题**：三项分数表示“强弱”还是“风险”、阈值 5 的语义，冻结策略与设计草案定义不一致，需策略负责人确认。
- **影响**：`P12-A_fixed`、`P12-C_fixed`、P20E 连续延伸验证；所有 `reason=holding_review_exit:two_triggered_remaining_score_ge_threshold` 的历史卖出（含 r2-0039、r2-0040）。
- **修复建议（留待下一任务）**：确认语义；若为风险分应改公式为“风险越高分越高”并明确缺失值不算通过；若为强弱分则重定义退出阈值语义。**本轮未翻转正负号、未改评分、未改阈值、未重跑收益。**

## 5. Recovery Gate / 前置门禁

| 门禁 | 结果 | 证据 |
|---|---|---|
| 基线可恢复 | PASS | 基线 `9b87e9f`；旧 `app.js`=`bf84380c…`、`styles.css`=`008e90fb…` 可由 `git show 9b87e9f:app.js` 恢复 |
| 修复前核心哈希 | PASS | `app.js bf84380c…`、`styles.css 008e90fb…`、`index.html 46c97d84…`、`data/v2_review.json be996e67…` |
| 修复前数据快照 | PASS | `data/v2_review.json`、`trades.json`、`sell_pnl.json` 修复前后哈希不变 |
| P21 维护源与发布根一致 | PASS | `site/app.js`==`app.js`（`ec9d64ce…`）、`site/styles.css`==`styles.css`（`76f507e4…`） |
| V1/V2 保留 | PASS | 17 个 `.nav-link`、4 个实验选项、V1 四组实验、V2 四页全部保留；导航 17/17×4 |
| 意见键保留 | PASS | `goldone_feedback` 未改；隔离上下文 sentinel 保留 |
| Pages 来源 | PASS | `master` / `/` / `legacy`；构建 `built`，commit `5de4b5c` |
| 回滚路径 | PASS | `ROLLBACK.md`；`git revert` 可逆，不强推 |
| 数据不漂移 | PASS | `data/v2_review.json`=`be996e67…` 修复前后与公网一致 |
| 安全扫描 | PASS | `scan_site.py`：35 文件，禁止项 0、外部 URL 0 |

## 6. 精确修改与新增文件清单

| 文件 | 修复前 SHA-256 | 修复后 SHA-256 | 是否在 allowlist |
|---|---|---|---|
| `app.js`（发布根 + 维护源） | `bf84380c0ee8af0ad13b44dc84138d6b7dc64b13437becd3eb447bc7ede73bb0` | `ec9d64ce73379eee238e4639c7721317fee34896942ae84a88fb2f3e803fe92a` | 是 |
| `styles.css`（发布根 + 维护源） | `008e90fb7a679a8641993a97951acd15122f4bdb231be09e88205a44707ae135` | `76f507e42cc2dfc9cc6c66bbd1bc44014bdd6d5e5fa83a79676ee2b8f44495eb` | 是 |
| `data/v2_trade_notes.json`（新增） | — | `9dff42c3ba4ee85315fc7f2bb6c268409b094725ba81df70a09a3202008545df` | 是 |
| `index.html` | `46c97d84…` | `46c97d84…`（未改） | 否（不需改） |
| `chart.min.js` | `d2af8974…` | `d2af8974…`（未改） | 否 |
| `data/v2_review.json` | `be996e67…` | `be996e67…`（未改） | 否 |

- 站点修复提交 `5de4b5c` 仅含 `app.js`、`styles.css`、`data/v2_trade_notes.json`（1 file changed 之外的 3 文件，+602/−17）。
- 未提交既有 `web/goldone-review/dist/*` 工作区修改，未提交任何既有未跟踪报告或数据文件。

## 7. 冻结契约与保护不变量

- `v2_review.json` `schema_version=3.0.0`、`contract_version=1.0.0` 未变；`v2_trade_notes.json` `schema_version=1.0.0`。
- `DATA_FILES` 仅追加 `v2_trade_notes.json`；`loadData` 对缺失文件容错，旧数据仍可加载。
- 红涨绿跌通过 CSS 变量集中维护：`--color-up`/`--color-down`/`--color-neutral`，无旧样式反向覆盖。
- 原网址不变；V1 四组实验、V2 A/C 与三区间、导航修复、交易筛选排序、`goldone_feedback` 及旧意见全部保留。
- 发布根与 P21 维护源 `outputs/web/v2_frozen_review/site/` 逐字节一致，下次本地构建不会恢复旧问题。

## 8. 测试 ID → 覆盖清单（无重复、无遗漏）

- `layout_{1920,1440,1024,390}_no_overflow`：4 宽度无横向溢出。
- `nav_{1920,1440,1024,390}_all_reachable`：17 链接 ×4 = 68 次真实指针/触摸点击。
- `stats_{1920,1440,1024,390}_{A_dev,A_new,A_full,C_full,C_dev,C_new}`：6 组基准 ×4 = 24 项。
- `trades_{width}_filter_symbol`：交易筛选 4 项。
- `feedback_{width}_isolation`：隔离上下文意见持久化 4 项。
- `console_{width}_clean`：4 项。
- 合计 4×(1+1+6+1+1+1)=**44**。
- 专项 `browser_check`（本地+公网各 20）：统计、期末持仓、三笔成交、评分审计、红绿颜色、无 console 错误。
- ID 形如 `stats_1920_A_dev`、`nav_390_all_reachable`、`color_positive_red`。

## 9. Mutation / 负向验证表

| ID | 注入/对照 | 编译/收集 | 杀死测试 | 是否恢复原字节 |
|---|---|---|---|---|
| N1 | 旧 CSS（`.positive`=绿）对照 | 无编译；页面正常 | `color_positive_red`/`color_negative_green` 在旧色下失败，证明测试能杀死旧行为 | 是（发布文件保持新色 `76f507e4…`） |
| N2 | 数据漂移负向 | N/A | `data/v2_review.json` 哈希修复前后/公网不一致即失败；本轮一致 `be996e67…` | 是（未改数据） |
| N3 | 意见已有记录被覆盖 | N/A | 隔离上下文预置 sentinel；新增后 sentinel 仍在、count=2 | 是（上下文销毁，不触碰真实记录） |
| N4 | 评分方向负向 | N/A | 页面展示“方向冲突/真实含义”，不冒称风险分；审计区分实现/定义问题 | N/A（只读） |

## 10. 本轮真实测试数字

| 测试集 | collected | passed | failed | skipped |
|---|---:|---:|---:|---:|
| V2 数据契约 `test_v2_contract.py` | 61 | 61 | 0 | 0 |
| 站点扫描 `scan_site.py`（文件数） | 35 | 35 | 0 | 0 |
| 本地浏览器（四宽度+功能+意见） | 44 | 44 | 0 | 0 |
| 公网浏览器（四宽度+功能+意见） | 44 | 44 | 0 | 0 |
| 专项检查（本地） | 20 | 20 | 0 | 0 |
| 专项检查（公网） | 20 | 20 | 0 | 0 |
| 公网文件哈希 | 36 | 36 | 0 | 0 |

数字均来自本轮实际执行，未引用旧轮次数字。

## 11. Decision 与接受边界

**Decision：展示修复 ACCEPT；评分方向 CONFIRMED（未修复）。**

依据：
1. 成交统计、期末持仓、买卖日期、三笔成交解释、红涨绿跌在本地与公网四宽度均通过；基准数字逐项核对一致。
2. V2 契约 61/61、站点扫描 0 禁止/0 外链、公网 36/36 哈希一致、Pages 构建对应 `5de4b5c`。
3. 评分方向审计确认方向冲突，但本轮未改策略/评分/阈值/收益，符合授权。

**Accepted：**
- V2 总览/交易页成交统计、期末持仓及明细、买入/卖出日期、未平仓标注、三笔成交解释、红涨绿跌。
- 同址发布、构建对应、文件哈希一致、四宽度本地+公网验证通过。

**Not accepted / 未证明：**
- 不证明策略有效、不证明收益可复现；本轮不改策略与研究数据。
- 评分方向问题**未修复**，仅审计；修复留待下一任务。
- 未做 Safari/Firefox/真实 iOS/Android 跨浏览器验证；本轮为 Chromium + 触摸仿真。
- 财务报告期与门禁值、逐条观察流水无法从冻结展示数据重建，页面已如实标注。

## 12. 最终 git 状态

- HEAD：`5de4b5c`（站点修复提交）；父 `9b87e9f`（P21-R1 校验记录）。
- 已跟踪工作区修改：仅既有 `web/goldone-review/dist/*` 7 个文件，与本任务无关，未暂存、未提交。
- 本任务新增未提交交付物：`outputs/web/v2_trade_review_r2/`（REPORT/ROLLBACK/SHA256SUMS/verify/verification/screenshots/evidence）。
- 完整 `git status --porcelain=v1` 见 `evidence/git_status_final.txt`（本轮生成）。

## 13. 未执行事项与合规声明

未执行：
- 未取行情、财务、指数或基金数据；未调用任何金融数据 provider。
- 未读取 `.env`；未安装依赖；未改数据库或历史实验；未改策略/评分/阈值/收益。
- 未调参、未启动自动任务、未启动模拟盘或实盘。
- 未强推、未 reset 远端、未提交无关文件或既有 `web/goldone-review/dist/*` 工作区修改。
- 未恢复归档代码、未跨切片改动。

合规声明：
- 本轮所有测试数字来自本轮实际执行，未引用旧轮次数字冒充。
- 修复前失败对照、修复后通过、控制台/请求状态、公网哈希均如实记录。
- “展示修复完成”仅指本报告的四宽度 Chromium 真实交互与发布校验范围；评分问题仅确认、未修复。

## 14. 证据索引

- `verification/local_full_results.json` / `public_full_results.json`：四宽度完整结果（44/44）。
- `verification/public_file_hashes.json`：公网 36 文件哈希。
- `build/build_trade_notes.py`：三笔成交与评分审计展示数据的只读派生脚本。
- `SHA256SUMS.txt`：发布文件哈希清单。
- `ROLLBACK.md`：回滚方式。
- `screenshots/`：四宽度本地与公网截图。
- `evidence/`：git status 等。