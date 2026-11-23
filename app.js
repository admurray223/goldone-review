/**
 * GoldOne Web Review Dashboard - schema 3.0.0 UI
 *
 * All pages read experiment values through one data contract (buildContract).
 * A missing field is rendered as "暂无数据" with a reason, never as 0.
 */

(function () {
    'use strict';

    const SCHEMA_VERSION = '3.0.0';
    const CONTRACT_VERSION = '1.0.0';
    const FEEDBACK_SCHEMA_VERSION = '2.2';
    const FEEDBACK_STORAGE_KEY = 'goldone_feedback';
    const EXPERIMENT_STORAGE_KEY = 'goldone_experiment';

    const EXPERIMENT_DEFS = [
        { id: 'original_C_baseline', implementation: 'original', group: 'C' },
        { id: 'original_R_baseline', implementation: 'original', group: 'R' },
        { id: 'fixed_C_baseline', implementation: 'fixed', group: 'C' },
        { id: 'fixed_R_baseline', implementation: 'fixed', group: 'R' }
    ];

    const GROUP_LABELS = {
        C: 'Group C · 评分优先',
        R: 'Group R · 随机/其他'
    };

    const IMPL_LABELS = {
        original: 'Original（含已确认风险状态缺陷）',
        fixed: 'Fixed（状态映射已修复，策略表达待审阅）'
    };

    const COST_SCENARIO_LABEL = 'baseline · 单倍佣金/滑点';

    const SEGMENT_DEFS = [
        { key: 'old_280d', label: '旧280日', start: '2024-09-02', end: '2025-10-31' },
        { key: 'parent_new_window', label: 'D2B 新增90日', start: '2025-11-03', end: '2026-03-18' },
        { key: 'old_window', label: '旧370日', start: '2024-09-02', end: '2026-03-18' },
        { key: 'new_window', label: 'D2C 新增90日', start: '2026-03-19', end: '2026-07-29' },
        { key: 'full_period', label: '完整460日', start: '2024-09-02', end: '2026-07-29' }
    ];

    const DATA_FILES = [
        'manifest.json',
        'experiments.json',
        'equity_curves.json',
        'drawdowns.json',
        'trades.json',
        'segment_metrics.json',
        'index_data.json',
        'universe_info.json',
        'coverage.json',
        'concentration.json',
        'data_quality.json',
        'version_history.json',
        'baseline_comparison.json',
        'd2c_status.json',
        'cost_attribution.json',
        'cost_sensitivity.json',
        'trading_frequency.json',
        'holding_period.json',
        'risk_events.json',
        'financial_availability.json',
        'segment_labels.json',
        'security_scan.json',
        'sell_pnl.json',
        'sell_pnl_summaries.json',
        'reconciliation.json',
        'v2_p2_status.json',
        'v2_p2_case.json',
        'v2_review.json',
        'v2_trade_notes.json'
    ];

    const state = {
        data: {},
        contract: null,
        currentPage: 'overview',
        experimentId: 'original_C_baseline',
        theme: 'light',
        feedback: [],
        filters: {
            trades: { experiment: '', side: '', reason: '', dateFrom: '', dateTo: '', symbol: '' }
        },
        pagination: {
            trades: { page: 1, pageSize: 50 }
        },
        sort: {
            trades: { column: 'fill_date', direction: 'desc' }
        },
        v2: {
            variant: 'A',
            period: 'full',
            timelinePage: 1,
            tradePage: 1,
            tradeSymbol: '',
            tradeSort: { column: 'fill_date', direction: 'desc' },
            whyPage: 1
        }
    };

    const els = {};

    function cacheElements() {
        els.mainContent = document.getElementById('mainContent');
        els.mainNav = document.getElementById('mainNav');
        els.versionBadge = document.getElementById('versionBadge');
        els.dataAsOf = document.getElementById('dataAsOf');
        els.experimentSelect = document.getElementById('experimentSelect');
        els.themeToggle = document.getElementById('themeToggle');
        els.exportFeedbackBtn = document.getElementById('exportFeedbackBtn');
        els.feedbackModal = document.getElementById('feedbackModal');
        els.feedbackForm = document.getElementById('feedbackForm');
        els.feedbackModalClose = document.getElementById('feedbackModalClose');
        els.feedbackCancel = document.getElementById('feedbackCancel');
        els.confirmModal = document.getElementById('confirmModal');
        els.confirmMessage = document.getElementById('confirmMessage');
        els.confirmCancel = document.getElementById('confirmCancel');
        els.confirmOk = document.getElementById('confirmOk');
        els.toastContainer = document.getElementById('toastContainer');
        els.viewManifestBtn = document.getElementById('viewManifestBtn');
        els.viewSecurityBtn = document.getElementById('viewSecurityBtn');
    }

    const fmt = {
        isNum(v) {
            return typeof v === 'number' && Number.isFinite(v);
        },
        money(v, dp) {
            if (!fmt.isNum(v)) return null;
            const d = dp === undefined ? 2 : dp;
            return v.toLocaleString('en-US', {
                minimumFractionDigits: d,
                maximumFractionDigits: d
            });
        },
        pct(v, dp) {
            if (!fmt.isNum(v)) return null;
            const d = dp === undefined ? 2 : dp;
            return (v * 100).toFixed(d) + '%';
        },
        count(v) {
            if (!fmt.isNum(v)) return null;
            return String(v);
        },
        date(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        },
        short(dateStr) {
            return dateStr ? dateStr.replace(/-/g, '/') : '-';
        }
    };

    const esc = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    function debounce(fn, delay) {
        let timer;
        return function () {
            const args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(null, args); }, delay);
        };
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function metric(value, reason, extra) {
        const m = { value: fmt.isNum(value) ? value : null, reason: reason || null };
        if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
        return m;
    }

    function naCell(reason) {
        const why = reason || '数据包未提供该字段';
        return '<span class="na" title="暂无数据：' + esc(why) + '">暂无数据</span>' +
            '<span class="na-reason">原因：' + esc(why) + '</span>';
    }

    function moneyCell(m) {
        if (!m || !fmt.isNum(m.value)) return naCell(m && m.reason);
        return '<span class="mono">' + fmt.money(m.value, m.dp === undefined ? 2 : m.dp) + '</span>';
    }

    function pctCell(m) {
        if (!m || !fmt.isNum(m.value)) return naCell(m && m.reason);
        const cls = m.value > 0 ? 'positive' : (m.value < 0 ? 'negative' : '');
        return '<span class="mono ' + cls + '">' + fmt.pct(m.value, m.dp === undefined ? 2 : m.dp) + '</span>';
    }

    function countCell(m) {
        if (!m || !fmt.isNum(m.value)) return naCell(m && m.reason);
        return '<span class="mono">' + fmt.count(m.value) + '</span>';
    }

    function absentZero(text) {
        return '<span class="muted">' + esc(text) + '</span>';
    }

    function valueOnOrBefore(series, date, field) {
        if (!Array.isArray(series) || !series.length) return null;
        let hit = null;
        for (let i = 0; i < series.length; i++) {
            const p = series[i];
            if (p.date <= date) hit = p;
            else break;
        }
        if (!hit) return null;
        return field ? hit[field] : hit;
    }

    function valueBefore(series, date, field) {
        if (!Array.isArray(series) || !series.length) return null;
        let hit = null;
        for (let i = 0; i < series.length; i++) {
            const p = series[i];
            if (p.date < date) hit = p;
            else break;
        }
        if (!hit) return null;
        return field ? hit[field] : hit;
    }

    function maxDrawdownOf(points, seed) {
        let peak = fmt.isNum(seed) ? seed : null;
        let maxDD = 0;
        points.forEach(function (p) {
            if (!fmt.isNum(p.total_equity)) return;
            if (peak === null || p.total_equity > peak) peak = p.total_equity;
            if (peak > 0) {
                const dd = p.total_equity / peak - 1;
                if (dd < maxDD) maxDD = dd;
            }
        });
        return maxDD;
    }

    function computeBenchmarkNewWindow(idx, segMetrics) {
        const startPt = valueOnOrBefore(idx, '2026-03-18', 'close');
        const endPt = valueOnOrBefore(idx, '2026-07-29', 'close');
        if (startPt && endPt && startPt.close > 0 && startPt.date < endPt.date) {
            return {
                value: endPt.close / startPt.close - 1,
                start_date: startPt.date,
                end_date: endPt.date,
                start_close: startPt.close,
                end_close: endPt.close,
                source: 'index_data.json 000300.SH close ' + startPt.date + ' -> ' + endPt.date,
                available: true
            };
        }
        const fallback = segMetrics && segMetrics.C && segMetrics.C.new_window
            ? segMetrics.C.new_window.benchmark_return : null;
        if (fmt.isNum(fallback)) {
            return {
                value: fallback,
                source: 'segment_metrics.json#C.new_window.benchmark_return',
                available: true
            };
        }
        return { value: null, source: null, available: false, reason: 'index_data.json 未覆盖 2026-03-18~2026-07-29' };
    }

    function deriveSegments(curve, trades, idx, initialEquity, impl) {
        return SEGMENT_DEFS.map(function (def) {
            const row = {
                key: def.key,
                label: def.label,
                start: def.start,
                end: def.end
            };
            if (!curve.length) {
                row.available = false;
                row.reason = '数据包缺少该实验的净值曲线，无法计算分段';
                return row;
            }
            const openingPt = valueBefore(curve, def.start);
            const firstPt = curve[0];
            const opening = openingPt
                ? openingPt.total_equity
                : (firstPt && firstPt.date === def.start ? initialEquity : null);
            const endPt = valueOnOrBefore(curve, def.end);
            if (!fmt.isNum(opening) || !endPt) {
                row.available = false;
                row.reason = '净值曲线未覆盖 ' + def.start + '~' + def.end;
                return row;
            }
            const points = curve.filter(function (p) {
                return p.date >= def.start && p.date <= def.end;
            });
            const end = endPt.total_equity;
            const ret = end / opening - 1;
            const bOpenPt = valueBefore(idx, def.start) || valueOnOrBefore(idx, def.start);
            const bEndPt = valueOnOrBefore(idx, def.end);
            const bRet = (bOpenPt && bEndPt && bOpenPt.close > 0 && bEndPt.date > bOpenPt.date)
                ? bEndPt.close / bOpenPt.close - 1 : null;
            const windowTrades = trades.filter(function (t) {
                const d = t.fill_date || t.trade_date;
                return d && d >= def.start && d <= def.end;
            });
            row.available = true;
            row.opening_equity = opening;
            row.end_equity = end;
            row.return = ret;
            row.benchmark_return = bRet;
            row.excess_return = fmt.isNum(bRet) ? ret - bRet : null;
            row.max_drawdown = maxDrawdownOf(points, opening);
            row.days = points.length;
            row.trade_count = windowTrades.length;
            row.buys = windowTrades.filter(function (t) { return t.side === 'buy'; }).length;
            row.sells = windowTrades.filter(function (t) { return t.side === 'sell'; }).length;
            row.source = 'derived: own equity curve (' + (impl === 'fixed' ? 'fixed' : 'original') + ') × index_data.json';
            return row;
        });
    }

    function buildExperiment(def, ctx) {
        const summary = ctx.exps[def.group] || null;
        const impl = def.implementation;
        const group = def.group;
        const curveKey = group + '_' + impl;
        const curve = Array.isArray(ctx.curves[curveKey]) ? ctx.curves[curveKey] : [];
        const groupTrades = Array.isArray(ctx.tradesRaw[group]) ? ctx.tradesRaw[group] : [];
        const trades = groupTrades.filter(function (t) {
            return (t.variant || 'original') === impl;
        });
        const initialEquity = (summary && fmt.isNum(summary.initial_equity))
            ? summary.initial_equity
            : (curve.length ? curve[0].total_equity : null);

        const finalFromSummary = summary ? summary['final_equity_' + impl + '_exact'] : undefined;
        const finalFromCurve = curve.length ? curve[curve.length - 1].total_equity : undefined;
        const totalReturnFromSummary = summary ? summary['total_return_' + impl] : undefined;
        const finalEquity = fmt.isNum(finalFromSummary) ? finalFromSummary
            : (fmt.isNum(finalFromCurve) ? finalFromCurve : null);
        const totalReturn = fmt.isNum(totalReturnFromSummary) ? totalReturnFromSummary
            : (fmt.isNum(finalEquity) && fmt.isNum(initialEquity) && initialEquity > 0
                ? finalEquity / initialEquity - 1 : null);

        const eq0318Curve = valueOnOrBefore(curve, '2026-03-18', 'total_equity');
        const eq0318Summary = summary && summary.segments
            ? (impl === 'fixed'
                ? (summary.segments.new_window_fixed || {}).opening_equity
                : (summary.segments.old_window || {}).end_equity)
            : undefined;
        const eq0318 = fmt.isNum(eq0318Curve) ? eq0318Curve
            : (fmt.isNum(eq0318Summary) ? eq0318Summary : null);
        const eq0729Curve = valueOnOrBefore(curve, '2026-07-29', 'total_equity');
        const eq0729 = fmt.isNum(eq0729Curve) ? eq0729Curve : finalEquity;

        const new90 = (fmt.isNum(eq0729) && fmt.isNum(eq0318) && eq0318 > 0)
            ? eq0729 / eq0318 - 1 : null;
        const benchmark = ctx.benchmarkNewWindow;
        const new90Excess = (fmt.isNum(new90) && benchmark.available && fmt.isNum(benchmark.value))
            ? new90 - benchmark.value : null;

        const tradeCount = summary && fmt.isNum(summary['trade_count_' + impl])
            ? summary['trade_count_' + impl] : (trades.length || 0);
        const buys = summary && fmt.isNum(summary['buys_' + impl])
            ? summary['buys_' + impl] : trades.filter(function (t) { return t.side === 'buy'; }).length;
        const sells = summary && fmt.isNum(summary['sells_' + impl])
            ? summary['sells_' + impl] : trades.filter(function (t) { return t.side === 'sell'; }).length;
        const sellReasons = summary && summary['sell_reasons_' + impl]
            ? summary['sell_reasons_' + impl] : {};
        const riskSells = fmt.isNum(sellReasons.risk_three_layer)
            ? sellReasons.risk_three_layer
            : trades.filter(function (t) { return t.reason === 'risk_three_layer'; }).length;

        const riskTrades = trades.filter(function (t) { return t.reason === 'risk_three_layer'; });
        let firstRisk = null;
        if (riskTrades.length) {
            let minFill = null;
            riskTrades.forEach(function (t) {
                const d = t.fill_date || t.trade_date;
                if (d && (minFill === null || d < minFill)) minFill = d;
            });
            for (let i = 0; i < riskTrades.length; i++) {
                const d = riskTrades[i].fill_date || riskTrades[i].trade_date;
                if (d === minFill) { firstRisk = riskTrades[i]; break; }
            }
        }

        const segments = deriveSegments(curve, trades, ctx.idx, initialEquity, impl);
        const segmentByKey = {};
        segments.forEach(function (s) { segmentByKey[s.key] = s; });

        const curveAvailable = curve.length > 0;
        const tradesAvailable = trades.length > 0;
        const summaryAvailable = fmt.isNum(finalEquity);

        return {
            id: def.id,
            label: (impl === 'fixed' ? 'Fixed ' : 'Original ') + group,
            implementation: impl,
            implementation_label: IMPL_LABELS[impl],
            group: group,
            group_label: GROUP_LABELS[group],
            cost_scenario: COST_SCENARIO_LABEL,
            window: summary && summary.window ? summary.window : { start: '2024-09-02', end: '2026-07-29' },
            trade_days: summary ? summary.trade_days : (curve.length || null),
            initial_equity: initialEquity,
            final_equity: finalEquity,
            total_return: totalReturn,
            equity_2026_03_18: eq0318,
            equity_2026_07_29: eq0729,
            new_90d_return: new90,
            benchmark_new_90d: benchmark.value,
            benchmark_source: benchmark.source,
            new_90d_excess: new90Excess,
            max_drawdown: curveAvailable ? maxDrawdownOf(curve, initialEquity) : null,
            trade_count: tradeCount,
            buys: buys,
            sells: sells,
            sell_reasons: sellReasons,
            risk_three_layer_sells: riskSells,
            first_risk_trade: firstRisk,
            final_positions: summary ? summary['final_positions_' + impl] : null,
            asset_identity_breaks: summary ? summary['asset_identity_breaks_' + impl] : null,
            segments: segments,
            segment_by_key: segmentByKey,
            availability: {
                summary: summaryAvailable,
                equity_curve: curveAvailable,
                trades: tradesAvailable,
                segments: curveAvailable
            },
            availability_detail: {
                summary: summaryAvailable ? '可用（experiments.json）' : '缺失（experiments.json 未提供该实现字段）',
                equity_curve: curveAvailable ? '可用（' + curve.length + ' 个交易日）'
                    : '缺失（equity_curves.json#' + curveKey + '）',
                trades: tradesAvailable ? '可用（' + trades.length + ' 笔）'
                    : '缺失（trades.json#' + group + ' variant=' + impl + '）',
                segments: curveAvailable ? '可用（由自身净值曲线推导）' : '缺失（无净值曲线，无法推导）'
            },
            source: {
                summary: 'experiments.json#' + group,
                equity_curve: 'equity_curves.json#' + curveKey,
                trades: 'trades.json#' + group + '[variant=' + impl + ']',
                segments: 'derived: equity_curves.json#' + curveKey + ' × index_data.json',
                benchmark: benchmark.source || 'index_data.json'
            },
            risk_fix_metadata: summary ? summary.risk_fix_metadata : null,
            curve_key: curveKey,
            note: impl === 'original'
                ? 'Original 组含已确认风险状态缺陷（sector_gate weakening != weak），仅作历史对照。'
                : 'Fixed 组已修复状态映射，但策略表达仍待用户审阅，不等于已接受策略。'
        };
    }

    function buildContract() {
        const exps = state.data.experiments || {};
        const curves = state.data.equity_curves || {};
        const tradesRaw = state.data.trades || {};
        const segMetrics = state.data.segment_metrics || {};
        const idx = Array.isArray(state.data.index_data) ? state.data.index_data : [];
        const benchmarkNewWindow = computeBenchmarkNewWindow(idx, segMetrics);
        const ctx = {
            exps: exps,
            curves: curves,
            tradesRaw: tradesRaw,
            idx: idx,
            benchmarkNewWindow: benchmarkNewWindow
        };
        const experiments = EXPERIMENT_DEFS.map(function (def) {
            return buildExperiment(def, ctx);
        });
        const byId = {};
        experiments.forEach(function (e) { byId[e.id] = e; });
        return {
            schema_version: SCHEMA_VERSION,
            contract_version: CONTRACT_VERSION,
            built_at: new Date().toISOString(),
            data_as_of: (state.data.manifest || {}).data_as_of || null,
            formal_baseline: (state.data.manifest || {}).formal_baseline || null,
            experiment_ids: experiments.map(function (e) { return e.id; }),
            benchmark_new_window: benchmarkNewWindow,
            experiments: experiments,
            by_id: byId,
            files: {
                manifest: !!state.data.manifest,
                experiments: !!state.data.experiments,
                equity_curves: !!state.data.equity_curves,
                trades: !!state.data.trades,
                segment_metrics: !!state.data.segment_metrics,
                index_data: idx.length > 0
            },
            formatting: {
                money_default_dp: 2,
                money_exact_dp: 6,
                percent_default_dp: 2,
                percent_segment_dp: 4,
                percent_benchmark_dp: 6
            }
        };
    }

    function contract() {
        if (!state.contract) state.contract = buildContract();
        return state.contract;
    }

    function currentExperiment() {
        return contract().by_id[state.experimentId] || contract().experiments[0];
    }

    async function loadData() {
        const results = await Promise.all(DATA_FILES.map(function (file) {
            return fetch('data/' + file).then(function (r) {
                return r.ok ? r.json() : null;
            }).catch(function () { return null; });
        }));
        DATA_FILES.forEach(function (file, i) {
            state.data[file.replace('.json', '')] = results[i];
        });
        loadFeedback();
        const man = state.data.manifest || {};
        if (man.formal_baseline) {
            els.versionBadge.textContent = 'schema ' + (man.schema_version || SCHEMA_VERSION) + ' · ' + man.formal_baseline;
        }
        if (man.data_as_of) {
            els.dataAsOf.textContent = '数据截止: ' + man.data_as_of +
                (man.generated_at ? ' | 生成时间: ' + new Date(man.generated_at).toLocaleString('zh-CN') : '');
        }
    }

    function loadFeedback() {
        try {
            const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
            state.feedback = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(state.feedback)) state.feedback = [];
        } catch (e) {
            state.feedback = [];
        }
    }

    function saveFeedback() {
        try {
            localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(state.feedback));
        } catch (e) {
            showToast('保存失败：存储空间不足', 'error');
        }
    }

    function addFeedback(feedback) {
        const newFeedback = Object.assign({
            id: generateId(),
            createdAt: new Date().toISOString(),
            status: 'pending'
        }, feedback);
        state.feedback.unshift(newFeedback);
        saveFeedback();
        return newFeedback;
    }

    function updateFeedback(id, updates) {
        const idx = state.feedback.findIndex(function (f) { return f.id === id; });
        if (idx !== -1) {
            state.feedback[idx] = Object.assign({}, state.feedback[idx], updates, {
                updatedAt: new Date().toISOString()
            });
            saveFeedback();
            return state.feedback[idx];
        }
        return null;
    }

    function deleteFeedback(id) {
        state.feedback = state.feedback.filter(function (f) { return f.id !== id; });
        saveFeedback();
    }

    function migrateFeedbackRecord(rec) {
        return Object.assign({
            schema_version: rec.schema_version || '1.0'
        }, rec, {
            schema_version_migrated_to: FEEDBACK_SCHEMA_VERSION
        });
    }

    function exportFeedback() {
        const data = {
            exportedAt: new Date().toISOString(),
            version: '2.0',
            schema_version: FEEDBACK_SCHEMA_VERSION,
            storage_key: FEEDBACK_STORAGE_KEY,
            feedback: state.feedback.map(migrateFeedbackRecord)
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'goldone_feedback_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('意见已导出', 'success');
    }

    function importFeedback(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data && data.feedback && Array.isArray(data.feedback)) {
                    const existingIds = new Set(state.feedback.map(function (f) { return f.id; }));
                    const newItems = data.feedback
                        .filter(function (f) { return f && f.id && !existingIds.has(f.id); })
                        .map(migrateFeedbackRecord);
                    state.feedback = newItems.concat(state.feedback);
                    saveFeedback();
                    renderPage('feedback');
                    showToast('导入 ' + newItems.length + ' 条新意见', 'success');
                } else {
                    showToast('文件格式不正确', 'error');
                }
            } catch (err) {
                showToast('导入失败：' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    function showToast(message, type) {
        const toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.innerHTML = '<span>' + esc(message) + '</span>' +
            '<button class="toast-close" aria-label="关闭">&times;</button>';
        toast.querySelector('.toast-close').onclick = function () { toast.remove(); };
        els.toastContainer.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 5000);
    }

    function openModal(modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        const focusable = modal.querySelector('input, select, textarea, button');
        if (focusable) focusable.focus();
    }

    function closeModal(modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    let confirmCallback = null;
    function showConfirm(message, callback) {
        els.confirmMessage.textContent = message;
        confirmCallback = callback;
        openModal(els.confirmModal);
    }

    const charts = { equity: null, drawdown: null, compare: null, v2Equity: null, v2Drawdown: null, v2Timeline: null, v2Funnel: null, v2FunnelDaily: null, v2Cumulative: null, v2Contribution: null };

    function destroyCharts() {
        Object.keys(charts).forEach(function (k) {
            if (charts[k]) {
                try { charts[k].destroy(); } catch (e) { /* noop */ }
                charts[k] = null;
            }
        });
    }

    function navigate(page) {
        state.currentPage = page;
        document.querySelectorAll('.nav-link').forEach(function (link) {
            link.classList.toggle('active', link.dataset.page === page);
        });
        renderPage(page);
        window.scrollTo(0, 0);
    }

    /* ===================== V2 FROZEN REVIEW ===================== */
    const V2_PERIODS = [
        { id: 'dev', label: '开发阶段', short: '开发', start: '2024-09-02', end: '2026-07-29' },
        { id: 'new', label: '新时间段', short: '新阶段', start: '2026-07-30', end: '2026-11-19' },
        { id: 'full', label: '连续全窗口', short: '全窗口', start: '2024-09-02', end: '2026-11-19' }
    ];
    const V2_COLORS = {
        A: '#2c7be5',
        C: '#e64980',
        muted: '#6c757d',
        success: '#28a745',
        danger: '#dc3545',
        warning: '#d99a06',
        info: '#17a2b8',
        grid: 'rgba(108,117,125,0.18)'
    };
    const V2_EVENT_META = {
        buy: { label: '买入', cls: 'badge-success', color: '#28a745' },
        sell: { label: '卖出', cls: 'badge-danger', color: '#dc3545' },
        review_exit: { label: '退出复评', cls: 'badge-warning', color: '#d99a06' },
        recovery: { label: '恢复复评', cls: 'badge-info', color: '#17a2b8' },
        dividend: { label: '分红', cls: 'badge-info', color: '#6f42c1' }
    };
    const V2_REASON_LABELS = {
        market_cooling_not_allowed: '市场降温',
        market_weakening_not_allowed: '市场转弱',
        market_unknown_not_allowed: '市场状态未知',
        sector_weakening_not_allowed: '板块转弱',
        sector_risk_not_allowed: '板块风险',
        sector_unknown_not_allowed: '板块状态未知',
        price_position_broken_not_allowed: '价格位置破位',
        price_position_extended_not_allowed: '价格位置过热',
        price_position_unknown_not_allowed: '价格位置未知'
    };

    function v2Data() {
        return state.data.v2_review || null;
    }

    function v2PeriodDef(id) {
        return V2_PERIODS.filter(function (p) { return p.id === id; })[0] || V2_PERIODS[2];
    }

    function v2CurrentId() {
        return state.v2.variant === 'C' ? 'P12-C_fixed' : 'P12-A_fixed';
    }

    function v2Exp(g) {
        const d = v2Data();
        return d && d.experiments ? d.experiments[g || state.v2.variant] : null;
    }

    function v2Money(v, dp, reason) {
        if (!fmt.isNum(v)) return naInline(reason || '数据包未提供该金额');
        return '<span class="mono">' + fmt.money(v, dp === undefined ? 2 : dp) + '</span>';
    }

    function v2Pct(v, dp, reason) {
        if (!fmt.isNum(v)) return naInline(reason || '数据包未提供该百分比');
        const cls = v > 0 ? 'positive' : (v < 0 ? 'negative' : '');
        return '<span class="mono ' + cls + '">' + fmt.pct(v, dp === undefined ? 2 : dp) + '</span>';
    }

    function v2SignedMoney(v, dp) {
        if (!fmt.isNum(v)) return naInline('数据包未提供该金额');
        const cls = v > 0 ? 'positive' : (v < 0 ? 'negative' : '');
        return '<span class="mono ' + cls + '">' + (v > 0 ? '+' : '') + fmt.money(v, dp === undefined ? 2 : dp) + '</span>';
    }

    function v2Rows(g, period) {
        const d = v2Data();
        if (!d || !d.timelines) return [];
        const def = v2PeriodDef(period);
        return (d.timelines[g] || []).filter(function (r) {
            return r.date >= def.start && r.date <= def.end;
        });
    }

    function v2Notes() {
        return state.data.v2_trade_notes || null;
    }

    function v2SignedPct(v, dp, reason) {
        if (!fmt.isNum(v)) return naInline(reason || '数据包未提供该百分比');
        const cls = v > 0 ? 'positive' : (v < 0 ? 'negative' : 'neutral');
        const sign = v > 0 ? '+' : '';
        return '<span class="mono ' + cls + '">' + sign + fmt.pct(v, dp === undefined ? 2 : dp) + '</span>';
    }

    // Derive open positions at the period end from the daily timeline events.
    // Only buy/sell fills count; signals, orders and cancellations never do.
    function v2PeriodEndHoldings(g, period) {
        const d = v2Data();
        if (!d || !d.timelines) return [];
        const def = v2PeriodDef(period);
        const pos = {};
        const lastBuy = {};
        (d.timelines[g] || []).forEach(function (r) {
            if (r.date < def.start || r.date > def.end) return;
            (r.events || []).forEach(function (e) {
                if (e.type === 'buy') {
                    pos[e.symbol] = (pos[e.symbol] || 0) + e.quantity;
                    lastBuy[e.symbol] = r.date;
                } else if (e.type === 'sell') {
                    pos[e.symbol] = (pos[e.symbol] || 0) - e.quantity;
                }
            });
        });
        const out = [];
        Object.keys(pos).forEach(function (sym) {
            if (pos[sym] > 0) {
                out.push({ symbol: sym, quantity: pos[sym], last_buy_date: lastBuy[sym] || null });
            }
        });
        out.sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; });
        return out;
    }

    function v2TradeStats(g, period) {
        const exp = v2Exp(g);
        const st = (exp && exp.periods) ? exp.periods[period] : null;
        const def = v2PeriodDef(period);
        const buy = st ? st.buy_orders : null;
        const sell = st ? st.sell_orders : null;
        const holdings = v2PeriodEndHoldings(g, period);
        return {
            buy: buy,
            sell: sell,
            total: (fmt.isNum(buy) && fmt.isNum(sell)) ? buy + sell : null,
            end_date: def.end,
            end_holdings: holdings,
            end_holdings_count: holdings.length,
            held_days: st ? st.held_days : null,
            trading_days: st ? st.trading_days : null
        };
    }

    // Holding cycles relevant to the current period: closed sells whose fill
    // date falls inside the period, plus positions still open at the period end.
    function v2HoldingCycles(g, period) {
        const d = v2Data();
        const def = v2PeriodDef(period);
        const cycles = [];
        const t = d && d.trades ? d.trades[g] : null;
        if (t && t.sells) {
            t.sells.forEach(function (s) {
                if (s.fill_date >= def.start && s.fill_date <= def.end) {
                    cycles.push({
                        symbol: s.symbol,
                        status: 'closed',
                        buy_date: s.entry_date,
                        sell_date: s.fill_date,
                        signal_date: s.signal_date,
                        holding_days: s.holding_trading_days,
                        quantity: s.quantity,
                        net_pnl: s.net_pnl,
                        net_return: s.net_return,
                        reason: s.reason,
                        cycle_id: s.cycle_id,
                        order_id: s.order_id
                    });
                }
            });
        }
        v2PeriodEndHoldings(g, period).forEach(function (h) {
            cycles.push({
                symbol: h.symbol,
                status: 'open',
                buy_date: h.last_buy_date,
                sell_date: null,
                signal_date: null,
                holding_days: null,
                quantity: h.quantity,
                net_pnl: null,
                net_return: null,
                reason: null,
                cycle_id: null,
                order_id: null
            });
        });
        cycles.sort(function (a, b) {
            const da = a.sell_date || a.buy_date || '';
            const db = b.sell_date || b.buy_date || '';
            return da < db ? 1 : (da > db ? -1 : 0);
        });
        return cycles;
    }

    function v2StatsBlock(g, period) {
        const s = v2TradeStats(g, period);
        const num = function (v) { return fmt.isNum(v) ? fmt.money(v, 0) : naInline('数据包未提供'); };
        const holdingsRows = s.end_holdings.map(function (h) {
            return '<tr><td class="mono">' + esc(h.symbol) + '</td><td class="mono">' +
                fmt.money(h.quantity, 0) + ' 股</td><td class="mono">' +
                esc(h.last_buy_date || '—') + '</td><td class="sub">区间结束日快照；未平仓</td></tr>';
        }).join('') || '<tr><td colspan="4">' + naCell('区间结束日无持仓（0 只）') + '</td></tr>';
        return '<div class="v2-kpi-grid">' +
            v2Kpi('买入成交笔数', num(s.buy), '按实际成交记录，不含信号/挂单/取消') +
            v2Kpi('卖出成交笔数', num(s.sell), '按实际成交记录') +
            v2Kpi('成交总笔数', num(s.total), '买入 + 卖出') +
            v2Kpi('区间结束日期', '<span class="mono">' + esc(s.end_date) + '</span>', '期末状态取该日快照') +
            v2Kpi('期末持仓股票数', num(s.end_holdings_count) + ' 只', '区间结束日仍持有的股票数') +
            v2Kpi('持仓周期数（当前区间）', num(v2HoldingCycles(g, period).length), '闭合周期 + 期末未平仓；与成交笔数不同口径') +
            '</div>' +
            '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">期末持仓明细</span>' +
            '<span class="card-sub">区间 ' + esc(v2PeriodDef(period).label) + ' 结束日 ' + esc(s.end_date) + ' 快照</span></div><div class="card-body">' +
            '<details class="v2-details"><summary>展开期末持仓明细（' + s.end_holdings_count + ' 只）</summary>' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>股票代码</th><th>持仓数量</th><th>最近买入成交日</th><th>说明</th></tr></thead><tbody>' +
            holdingsRows + '</tbody></table></div>' +
            '<div class="v2-note">期末状态来自区间结束日快照，不把上一阶段的持仓沿用到本阶段；平均持仓数、期间持有过的股票数、期末持仓数分列。</div></details></div></div>';
    }

    function v2ScoringAuditCard() {
        const n = v2Notes();
        const a = n && n.scoring_audit;
        if (!a) {
            return '<div class="card"><div class="card-header"><span class="card-title">评分方向审计</span></div><div class="card-body">' +
                naCell('缺少 data/v2_trade_notes.json，无法展示评分方向审计') + '</div></div>';
        }
        const caseRows = (a.cases || []).map(function (c) {
            return '<tr><td class="mono">' + esc(c.symbol) + '</td><td class="mono">' + esc(c.date) + '</td><td>' +
                esc(c.remaining_dimension) + '</td><td class="mono">' + esc(String(c.remaining_score)) +
                '</td><td class="mono">' + esc(String(c.threshold)) + '</td><td class="text-wrap sub">' + esc(c.derivation) + '</td></tr>';
        }).join('');
        const cls = a.classification || {};
        const li = function (arr) {
            return (arr || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
        };
        const aff = a.affected || {};
        return '<div class="card"><div class="card-header"><span class="card-title">评分方向专项审计（只读，未改策略）</span>' +
            '<span class="card-sub">区分确定性实现问题与策略定义问题</span></div><div class="card-body">' +
            '<div class="v2-callout warning"><strong>真实含义：</strong>' + esc(a.score_meaning) + '</div>' +
            '<div class="v2-callout danger"><strong>方向冲突：</strong>' + esc(a.direction_conflict) + '</div>' +
            '<div class="v2-note">公式：<span class="mono">' + esc(a.formula) + '</span>；退出规则：' + esc(a.exit_rule) + '</div>' +
            '<div class="table-container" style="margin-top:12px;"><table class="matrix-table"><thead><tr><th>股票</th><th>复核日</th><th>剩余维度</th><th>剩余分</th><th>阈值</th><th>来源推导</th></tr></thead><tbody>' +
            caseRows + '</tbody></table></div>' +
            '<div class="v2-grid-2" style="margin-top:12px;">' +
            '<div><strong>确定性实现问题</strong><ul class="v2-limits">' + li(cls.deterministic_implementation_issue) + '</ul></div>' +
            '<div><strong>策略定义问题</strong><ul class="v2-limits">' + li(cls.strategy_definition_issue) + '</ul></div>' +
            '</div>' +
            '<div class="v2-note"><strong>影响：</strong>冻结版本 ' + esc((aff.frozen_versions || []).join('、')) +
            '；受影响交易：' + esc((aff.trades || []).join('；')) + '。' + esc(aff.note || '') + '</div>' +
            '<div class="v2-callout info"><strong>修复建议（留待下一任务）：</strong>' + esc(a.recommendation) + '</div>' +
            '<div class="v2-note">本页只展示评分真实含义与已发现疑点，不冒称风险分；本轮未翻转正负号、未改评分、未改阈值、未重跑收益。</div>' +
            '</div></div>';
    }

    function v2HoldingCyclesTable(g, period) {
        const cycles = v2HoldingCycles(g, period);
        const rows = cycles.map(function (c) {
            const open = c.status === 'open';
            const statusBadge = open
                ? '<span class="badge badge-warning">未平仓</span>'
                : '<span class="badge badge-neutral">已平仓</span>';
            const sellDate = open ? '<span class="na">尚未卖出</span>' : '<span class="mono">' + esc(c.sell_date) + '</span>';
            const pnl = open ? '<span class="na">未平仓</span>' : v2SignedMoney(c.net_pnl, 2);
            const ret = open ? '<span class="na">—</span>' : v2SignedPct(c.net_return, 4, '分母缺失或为0');
            const sig = open ? '<span class="muted">—</span>' : '<span class="mono">' + esc(c.signal_date || '—') + '</span>';
            const hd = fmt.isNum(c.holding_days) ? c.holding_days : '<span class="na">缺日历</span>';
            return '<tr><td><strong class="mono">' + esc(c.symbol) + '</strong></td><td>' + statusBadge + '</td>' +
                '<td class="mono">' + esc(c.buy_date || '—') + '</td>' +
                '<td>' + sellDate + '</td>' +
                '<td class="mono">' + hd + '</td>' +
                '<td class="mono">' + pnl + '</td>' +
                '<td class="mono">' + ret + '</td>' +
                '<td class="mono">' + sig + '</td>' +
                '<td class="sub text-wrap">' + (open ? '买入后尚未卖出；卖出日与盈亏为未平仓，不取期末日期冒充卖出日' : esc(c.reason || '') + '<div class="sub">cycle ' + esc(c.cycle_id === null || c.cycle_id === undefined ? '—' : c.cycle_id) + ' · 订单 ' + esc(c.order_id || '—') + '</div>') + '</td></tr>';
        }).join('') || '<tr><td colspan="8">' + naCell('该区间无持仓周期') + '</td></tr>';
        return '<div class="card"><div class="card-header"><span class="card-title">成交与持仓周期</span>' +
            '<span class="card-sub">买入成交日 / 卖出成交日分列；信号日单独列；未平仓标注“尚未卖出”</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>股票</th><th>操作</th><th>买入成交日</th><th>卖出成交日</th><th>持有交易日</th><th>净盈亏</th><th>净收益率</th><th>卖出信号日</th><th>原因 / 周期</th></tr></thead><tbody>' +
            rows + '</tbody></table></div>' +
            '<div class="v2-note">本数据集每笔卖出对应单一买入批次（matched_lots 均为 1 条），按实际匹配记录展示；无多批次买入或部分卖出。买入行关联的后来卖出日属于事后展示，不进入策略输入。日期筛选按“卖出成交日（fill_date）”进行，不按信号日或期末日。</div></div></div>';
    }

    function v2TradeNotesCards() {
        const n = v2Notes();
        if (!n || !n.new_stage_explanations) {
            return '<div class="card"><div class="card-header"><span class="card-title">新阶段三笔成交解释</span></div><div class="card-body">' +
                naCell('缺少 data/v2_trade_notes.json，无法展示三笔成交解释') + '</div></div>';
        }
        const cards = n.new_stage_explanations.map(function (e) {
            const isBuy = e.side === 'buy';
            const badge = isBuy ? '<span class="badge badge-success">买入</span>' : '<span class="badge badge-danger">卖出</span>';
            const price = e.price || {};
            const cond = e.conditions || {};
            const trig = e.sell_trigger || {};
            const lots = (e.matched_lots || []).map(function (l) {
                return esc(l.buy_date) + ' × ' + fmt.money(l.quantity, 0) + ' 股 @ ' + fmt.money(l.fill_price, 4);
            }).join('<br>') || '—';
            const priceRows = '<tr><th>真实未复权开盘价</th><td class="mono">' + fmt.money(price.raw_open, 4) + '</td></tr>' +
                '<tr><th>成交价（含滑点）</th><td class="mono">' + fmt.money(price.fill_price, 4) + ' <span class="sub">' + esc(price.price_channel || '') + '</span></td></tr>' +
                '<tr><th>数量 / 金额</th><td class="mono">' + fmt.money(e.quantity, 0) + ' 股 / ' + fmt.money(price.notional, 2) + ' 元</td></tr>' +
                '<tr><th>费用（佣金/过户/印花）</th><td class="mono">' + fmt.money(price.commission, 2) + ' / ' + fmt.money(price.transfer_fee, 2) + ' / ' + fmt.money(price.stamp_tax, 2) + '，合计 ' + fmt.money(price.total_fees, 2) + '</td></tr>' +
                (isBuy ? '<tr><th>总成本</th><td class="mono">' + fmt.money(price.total_cost, 2) + ' 元</td></tr>' : '<tr><th>卖出净回款 / 净盈亏</th><td class="mono">' + fmt.money(price.net_proceeds, 2) + ' / ' + v2SignedMoney(price.net_pnl, 2) + '</td></tr>');
            const condRows = '<tr><th>市场</th><td>' + esc(cond.market || '—') + '</td><th>板块</th><td>' + esc(cond.sector || '—') + '</td></tr>' +
                '<tr><th>价格位置</th><td>' + esc(cond.price_position || '—') + '</td><th>财务门禁</th><td>' + esc(cond.financial_state || '—') + '</td></tr>' +
                '<tr><th>财务说明</th><td colspan="3" class="text-wrap">' + esc(cond.financial_detail || '—') + '</td></tr>';
            const trigRows = trig.remaining_dimension ?
                '<tr><th>卖出触发维度</th><td>' + esc((trig.triggers || []).join('、')) + '</td><th>组合</th><td>' + esc(trig.combination || '—') + '</td></tr>' +
                '<tr><th>剩余维度</th><td>' + esc(trig.remaining_dimension) + '</td><th>剩余分 / 阈值</th><td class="mono">' + esc(String(trig.remaining_score)) + ' / ' + esc(String(trig.threshold)) + '</td></tr>' +
                '<tr><th>三项分数</th><td colspan="3" class="mono">market ' + esc(String((trig.scores || {}).market)) + ' · sector ' + esc(String((trig.scores || {}).sector)) + ' · stock ' + esc(String((trig.scores || {}).stock)) + '</td></tr>' +
                '<tr><th>公式</th><td colspan="3" class="text-wrap">' + esc(trig.formula || '') + '</td></tr>' : '';
            return '<details class="v2-details v2-trade-note"><summary>' + badge + ' <strong class="mono">' + esc(e.symbol) + '</strong> ' + esc(e.name || '') +
                ' · 信号 ' + esc(e.signal_date) + ' → 成交 ' + esc(e.fill_date) + ' · ' + fmt.money(e.quantity, 0) + ' 股</summary>' +
                '<div class="v2-trade-note-body">' +
                '<div class="v2-grid-2"><div><strong>价格与费用</strong><div class="table-container"><table class="matrix-table">' + priceRows + '</table></div></div>' +
                '<div><strong>买卖条件</strong><div class="table-container"><table class="matrix-table">' + condRows + '</table></div>' +
                (isBuy && e.budget ? '<div class="v2-note"><strong>预算依据：</strong>' + esc(e.budget.basis || '') + (fmt.isNum(e.budget.reserved_budget) ? '（reserved_budget ' + fmt.money(e.budget.reserved_budget, 2) + '）' : '') + '</div>' : '') +
                '</div></div>' +
                (!isBuy && trig.remaining_dimension ? '<div style="margin-top:12px;"><strong>卖出评分与触发</strong><div class="table-container"><table class="matrix-table">' + trigRows + '</table></div>' +
                    '<div class="v2-note">匹配买入批次：' + lots + '</div></div>' : '') +
                '<div class="v2-grid-2" style="margin-top:12px;">' +
                '<div class="v2-mini-stat"><div class="v2-kpi-label">财务报告期 / 门禁值</div><div class="v2-kpi-value na">无法重建</div><div class="v2-kpi-sub">' + esc((e.financial_report || {}).note || '') + '</div></div>' +
                '<div class="v2-mini-stat"><div class="v2-kpi-label">观察资格 / 观察记录</div><div class="v2-kpi-value">' + (e.observation && e.observation.eligible ? '具备资格' : '—') + '</div><div class="v2-kpi-sub">' + esc((e.observation || {}).note || '') + '</div></div>' +
                '</div>' +
                '<ul class="v2-limits">' + (e.notes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
                '</div></details>';
        }).join('');
        return '<div class="card"><div class="card-header"><span class="card-title">新阶段三笔成交解释</span>' +
            '<span class="card-sub">信号日 vs 成交日；数量与预算；真实开盘价、滑点、费用；买卖条件与评分</span></div><div class="card-body">' +
            '<div class="v2-callout info">' + esc(n.simulation_timing || '') + '</div>' +
            '<div class="v2-callout warning">' + esc(n.disclaimer || '') + '</div>' +
            cards + '</div></div>';
    }

    function v2EventBadge(type) {
        const m = V2_EVENT_META[type] || { label: type, cls: 'badge-neutral' };
        return '<span class="badge ' + m.cls + '">' + esc(m.label) + '</span>';
    }

    function v2EventText(e) {
        if (e.type === 'buy') {
            return '买入 ' + esc(e.symbol) + ' ' + fmt.money(e.quantity, 0) + ' 股 @ ' + fmt.money(e.price, 4) +
                '，金额 ' + fmt.money(e.amount, 2) + '（' + esc(e.order_id || '') + '）';
        }
        if (e.type === 'sell') {
            return '卖出 ' + esc(e.symbol) + ' ' + fmt.money(e.quantity, 0) + ' 股 @ ' + fmt.money(e.price, 4) +
                '，回款 ' + fmt.money(e.amount, 2) + '，净盈亏 ' + fmt.money(e.net_pnl, 2) + '（' + esc(e.order_id || '') + '）';
        }
        if (e.type === 'review_exit') {
            return '退出复评：' + esc(e.symbol) + '；剩余维度分数 ' +
                (fmt.isNum(e.remaining_score) ? fmt.money(e.remaining_score, 6) : '暂无数据') +
                ' / 阈值 ' + (fmt.isNum(e.threshold) ? fmt.money(e.threshold, 2) : '暂无数据') +
                '；订单 ' + esc(e.order_id || '');
        }
        if (e.type === 'recovery') {
            return esc(e.detail || '首次恢复正常复评') + '：' + esc(e.symbol || '');
        }
        if (e.type === 'dividend') {
            return '现金分红 ' + esc(e.symbol) + ' ' + fmt.money(e.amount, 2) + ' 元（税前）';
        }
        return esc(e.type);
    }

    function v2Controls() {
        const variant = state.v2.variant;
        const period = state.v2.period;
        return '<div class="v2-control-bar">' +
            '<div class="v2-control-group"><span class="v2-control-label">方案</span><div class="v2-seg">' +
            ['A', 'C'].map(function (g) {
                return '<button type="button" class="v2-seg-btn' + (variant === g ? ' active' : '') +
                    '" data-v2-variant="' + g + '">' + (g === 'A' ? 'P12-A_fixed · 主方案' : 'P12-C_fixed · 对照') + '</button>';
            }).join('') + '</div></div>' +
            '<div class="v2-control-group"><span class="v2-control-label">区间</span><div class="v2-seg">' +
            V2_PERIODS.map(function (p) {
                return '<button type="button" class="v2-seg-btn' + (period === p.id ? ' active' : '') +
                    '" data-v2-period="' + p.id + '">' + esc(p.label) + '</button>';
            }).join('') + '</div></div>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-v2-feedback>记录意见</button>' +
            '</div>';
    }

    function v2PageHeader(title, subtitle, opts) {
        const d = v2Data();
        if (!d) {
            return sectionHeader(title, 'V2 数据包未加载') +
                '<div class="alert alert-warning">暂无数据：data/v2_review.json 未成功加载，V1 页面不受影响。</div>';
        }
        const def = v2PeriodDef(state.v2.period);
        return sectionHeader(title, subtitle) +
            '<div class="v2-banner">' +
            '<div class="v2-banner-line"><span class="badge badge-warning">V2 独立入口</span>' +
            '<strong>' + esc(v2CurrentId()) + '</strong>' +
            '<span class="badge ' + (state.v2.variant === 'A' ? 'badge-info' : 'badge-neutral') + '">' +
            (state.v2.variant === 'A' ? '主方案' : '对照') + '</span>' +
            '<span class="v2-muted">V1 四组 Original/Fixed × C/R 结果保留在旧页面；本入口不回写 V1。</span></div>' +
            '<div class="v2-banner-meta">当前区间：' + esc(def.label) + ' ' + esc(def.start) + ' ~ ' + esc(def.end) +
            ' · 数据截止 ' + esc(d.periods.full.end) + ' · 意见存储键 <span class="mono">goldone_feedback</span></div>' +
            '</div>' + v2Controls();
    }

    function bindV2(container) {
        container.querySelectorAll('[data-v2-variant]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.v2.variant = btn.getAttribute('data-v2-variant');
                state.v2.timelinePage = 1;
                state.v2.tradePage = 1;
                state.v2.whyPage = 1;
                try { localStorage.setItem('goldone_v2_variant', state.v2.variant); } catch (e) { /* noop */ }
                renderPage(state.currentPage);
            });
        });
        container.querySelectorAll('[data-v2-period]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.v2.period = btn.getAttribute('data-v2-period');
                state.v2.timelinePage = 1;
                state.v2.tradePage = 1;
                state.v2.whyPage = 1;
                try { localStorage.setItem('goldone_v2_period', state.v2.period); } catch (e) { /* noop */ }
                renderPage(state.currentPage);
            });
        });
        const fb = container.querySelector('[data-v2-feedback]');
        if (fb) {
            fb.addEventListener('click', function () {
                openFeedbackModal({ version: v2CurrentId(), experiment: v2CurrentId(), page: state.currentPage });
            });
        }
        container.querySelectorAll('[data-v2-timeline-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.v2.timelinePage = parseInt(btn.getAttribute('data-v2-timeline-page'), 10) || 1;
                renderPage(state.currentPage);
            });
        });
        container.querySelectorAll('[data-v2-why-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.v2.whyPage = parseInt(btn.getAttribute('data-v2-why-page'), 10) || 1;
                renderPage(state.currentPage);
            });
        });
        container.querySelectorAll('[data-v2-trade-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.v2.tradePage = parseInt(btn.getAttribute('data-v2-trade-page'), 10) || 1;
                renderPage(state.currentPage);
            });
        });
        container.querySelectorAll('[data-v2-sort]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const col = btn.getAttribute('data-v2-sort');
                if (state.v2.tradeSort.column === col) {
                    state.v2.tradeSort.direction = state.v2.tradeSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    state.v2.tradeSort.column = col;
                    state.v2.tradeSort.direction = col === 'symbol' ? 'asc' : 'desc';
                }
                state.v2.tradePage = 1;
                renderPage(state.currentPage);
            });
        });
        const sym = container.querySelector('#v2SymbolFilter');
        if (sym) {
            sym.addEventListener('change', function () {
                state.v2.tradeSymbol = sym.value;
                state.v2.tradePage = 1;
                renderPage(state.currentPage);
            });
        }
    }

    const v2EventPlugin = {
        id: 'v2EventLines',
        afterDatasetsDraw: function (chart, args, opts) {
            const events = (opts && opts.events) || [];
            if (!events.length || !chart.scales.x) return;
            const x = chart.scales.x;
            const area = chart.chartArea;
            const ctx = chart.ctx;
            ctx.save();
            events.forEach(function (ev) {
                const idx = chart.data.labels.indexOf(ev.date);
                if (idx < 0) return;
                const px = x.getPixelForValue(idx);
                if (px < area.left || px > area.right) return;
                ctx.strokeStyle = ev.color || V2_COLORS.muted;
                ctx.globalAlpha = 0.18;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px, area.top);
                ctx.lineTo(px, area.bottom);
                ctx.stroke();
            });
            ctx.restore();
        }
    };

    function v2SetChart(key, canvasId, config, withEvents) {
        const ctx = chartReady(canvasId);
        if (!ctx) return;
        if (withEvents) config.plugins = [v2EventPlugin];
        if (charts[key]) {
            try { charts[key].destroy(); } catch (e) { /* noop */ }
        }
        charts[key] = new Chart(ctx, config);
    }

    function v2EquityChartData(g, period) {
        const rows = v2Rows(g, period);
        if (!rows.length) return null;
        const base = rows[0].equity;
        return {
            labels: rows.map(function (r) { return r.date; }),
            data: rows.map(function (r) { return base ? r.equity / base * 100 : null; }),
            base_date: rows[0].date,
            base_equity: base
        };
    }

    function drawV2Equity(period) {
        const a = v2EquityChartData('A', period);
        const c = v2EquityChartData('C', period);
        if (!a || !c) return;
        v2SetChart('v2Equity', 'v2EquityChart', {
            type: 'line',
            data: {
                labels: a.labels,
                datasets: [
                    { label: 'P12-A_fixed（主方案）', data: a.data, borderColor: V2_COLORS.A, backgroundColor: 'rgba(44,123,229,0.08)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.1, fill: false },
                    { label: 'P12-C_fixed（对照）', data: c.data, borderColor: V2_COLORS.C, backgroundColor: 'rgba(230,73,128,0.08)', borderWidth: 1.6, pointRadius: 0, pointHoverRadius: 4, tension: 0.1, fill: false }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + '：' + (fmt.isNum(c2.raw) ? c2.raw.toFixed(2) : '暂无数据') + '（起点=100）'; } } }
                },
                scales: {
                    x: { ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 }, title: { display: true, text: '日期' } },
                    y: { title: { display: true, text: '归一化权益（区间起点=100）' }, ticks: { callback: function (v) { return Number(v).toFixed(0); } } }
                }
            }
        });
    }

    function drawV2Drawdown(period) {
        const labels = v2Rows('A', period).map(function (r) { return r.date; });
        function dd(g) {
            let peak = null;
            return v2Rows(g, period).map(function (r) {
                if (peak === null || r.equity > peak) peak = r.equity;
                return peak ? (r.equity / peak - 1) * 100 : 0;
            });
        }
        if (!labels.length) return;
        v2SetChart('v2Drawdown', 'v2DrawdownChart', {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'A 回撤', data: dd('A'), borderColor: V2_COLORS.A, backgroundColor: 'rgba(44,123,229,0.12)', borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.1 },
                    { label: 'C 回撤', data: dd('C'), borderColor: V2_COLORS.C, backgroundColor: 'rgba(230,73,128,0.08)', borderWidth: 1.2, pointRadius: 0, fill: false, tension: 0.1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + '：' + (fmt.isNum(c2.raw) ? c2.raw.toFixed(2) : '暂无数据') + '%'; } } } },
                scales: {
                    x: { ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } },
                    y: { title: { display: true, text: '回撤（%）' }, ticks: { callback: function (v) { return Number(v).toFixed(0) + '%'; } } }
                }
            }
        });
    }

    function drawV2Timeline(period) {
        const g = state.v2.variant;
        const rows = v2Rows(g, period);
        if (!rows.length) return;
        const events = [];
        rows.forEach(function (r) {
            (r.events || []).forEach(function (e) {
                if (e.type === 'review_exit' || e.type === 'buy' || e.type === 'sell' || e.type === 'recovery') {
                    events.push({ date: r.date, color: (V2_EVENT_META[e.type] || {}).color || V2_COLORS.muted });
                }
            });
        });
        v2SetChart('v2Timeline', 'v2TimelineChart', {
            type: 'line',
            data: {
                labels: rows.map(function (r) { return r.date; }),
                datasets: [
                    { label: '股票市值 / 总权益', data: rows.map(function (r) { return r.exposure * 100; }), borderColor: V2_COLORS.A, backgroundColor: 'rgba(44,123,229,0.10)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.1 },
                    { label: '现金 / 总权益', data: rows.map(function (r) { return r.cash_ratio * 100; }), borderColor: V2_COLORS.success, backgroundColor: 'rgba(40,167,69,0.05)', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + '：' + (fmt.isNum(c2.raw) ? c2.raw.toFixed(2) : '暂无数据') + '%'; } } },
                    v2EventLines: { events: events }
                },
                scales: {
                    x: { ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 }, title: { display: true, text: '日期' } },
                    y: { min: 0, max: 100, title: { display: true, text: '占总权益（%）' }, ticks: { callback: function (v) { return Number(v).toFixed(0) + '%'; } } }
                }
            }
        }, true);
    }

    function drawV2Funnel(period) {
        const g = state.v2.variant;
        const stats = v2Data().why_not_buy[g][period];
        const stages = [
            { label: '可评估符号日', value: stats.evaluable_symbol_days },
            { label: '财务通过', value: stats.financial_passed_symbol_days },
            { label: '权限通过', value: stats.permission_passed_symbol_days },
            { label: '新候选', value: stats.new_candidate_instances },
            { label: '买入意图', value: stats.buy_intents }
        ];
        v2SetChart('v2Funnel', 'v2FunnelChart', {
            type: 'bar',
            data: {
                labels: stages.map(function (s) { return s.label; }),
                datasets: [{ label: '符号日 / 实例', data: stages.map(function (s) { return s.value; }), backgroundColor: ['#2c7be5', '#4c8fe8', '#74a7ec', '#d99a06', '#28a745'], borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c2) { return fmt.money(c2.raw, 0) + ' 个'; } } } },
                scales: { x: { title: { display: true, text: '符号日 / 实例数' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } }, y: { ticks: { autoSkip: false } } }
            }
        });
        v2SetChart('v2FunnelDaily', 'v2FunnelDailyChart', {
            type: 'line',
            data: {
                labels: stats.daily.map(function (d) { return d.date; }),
                datasets: [
                    { label: '财务通过', data: stats.daily.map(function (d) { return d.financial_passed; }), borderColor: V2_COLORS.A, borderWidth: 1.4, pointRadius: 0, tension: 0.1, fill: false },
                    { label: '权限通过', data: stats.daily.map(function (d) { return d.permission_passed; }), borderColor: V2_COLORS.success, borderWidth: 1.4, pointRadius: 0, tension: 0.1, fill: false },
                    { label: '新候选', data: stats.daily.map(function (d) { return d.new_candidates; }), borderColor: V2_COLORS.warning, borderWidth: 1.8, pointRadius: 0, tension: 0.1, fill: false }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + '：' + fmt.money(c2.raw, 0); } } } },
                scales: { x: { ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } }, y: { title: { display: true, text: '个数' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } } }
            }
        });
    }

    function drawV2Contribution(g) {
        const c = v2Data().trades[g].new_stage;
        const labels = c.contributions.map(function (x) { return x.symbol; });
        const vals = c.contributions.map(function (x) { return x.contribution; });
        v2SetChart('v2Contribution', 'v2ContributionChart', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{ label: '新阶段贡献（元）', data: vals, backgroundColor: vals.map(function (v) { return v >= 0 ? '#d9363e' : '#1a9e5f'; }), borderRadius: 4 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c2) { return fmt.money(c2.raw, 2) + ' 元'; } } } },
                scales: { x: { ticks: { autoSkip: false } }, y: { title: { display: true, text: '贡献（元）' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } } }
            }
        });
    }

    function drawV2Cumulative(period) {
        const g = state.v2.variant;
        const sells = v2Data().trades[g].sells.filter(function (s) {
            const def = v2PeriodDef(period);
            return s.fill_date >= def.start && s.fill_date <= def.end;
        });
        let cum = 0;
        const labels = [];
        const vals = [];
        sells.forEach(function (s) {
            cum += s.net_pnl;
            labels.push(s.fill_date);
            vals.push(cum);
        });
        v2SetChart('v2Cumulative', 'v2CumulativeChart', {
            type: 'line',
            data: { labels: labels, datasets: [{ label: '区间内累计已实现净盈亏（元）', data: vals, borderColor: V2_COLORS.A, backgroundColor: 'rgba(44,123,229,0.10)', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.1 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: function (c2) { return fmt.money(c2.raw, 2) + ' 元'; } } } },
                scales: { x: { ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } }, y: { title: { display: true, text: '累计净盈亏（元）' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } } }
            }
        });
    }

    function v2Kpi(label, valueHtml, sub, cls) {
        return '<div class="v2-kpi ' + (cls || '') + '"><div class="v2-kpi-label">' + esc(label) + '</div>' +
            '<div class="v2-kpi-value">' + valueHtml + '</div>' +
            (sub ? '<div class="v2-kpi-sub">' + sub + '</div>' : '') + '</div>';
    }

    function v2Pager(total, page, pageSize, attr) {
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const p = Math.min(Math.max(1, page), pages);
        return '<div class="pagination"><div class="pagination-info">第 ' + p + ' / ' + pages + ' 页 · 共 ' + total + ' 行</div>' +
            '<div class="pagination-controls">' +
            '<button class="pagination-btn" ' + attr + '="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + '>上一页</button>' +
            '<button class="pagination-btn" ' + attr + '="' + (p + 1) + '"' + (p >= pages ? ' disabled' : '') + '>下一页</button>' +
            '</div></div>';
    }

    function v2SortHeader(label, col) {
        const active = state.v2.tradeSort.column === col;
        const arrow = active ? (state.v2.tradeSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        return '<th><button type="button" class="v2-sort-btn' + (active ? ' active' : '') + '" data-v2-sort="' + col + '">' + esc(label) + arrow + '</button></th>';
    }

    function renderV2Overview(container) {
        const d = v2Data();
        const g = state.v2.variant;
        const p = state.v2.period;
        if (!d) {
            container.innerHTML = v2PageHeader('V2 总览', '冻结结果审阅') + '<div class="alert alert-warning">暂无数据：data/v2_review.json 未加载。</div>';
            return;
        }
        const exp = v2Exp(g);
        const st = exp.periods[p];
        const other = d.experiments[g === 'A' ? 'C' : 'A'];
        const otherSt = other.periods[p];
        const otherLabel = g === 'A' ? 'C' : 'A';

        const periodRows = V2_PERIODS.map(function (def) {
            const a = d.experiments.A.periods[def.id];
            const c = d.experiments.C.periods[def.id];
            return '<tr><td><strong>' + esc(def.label) + '</strong><div class="sub">' + def.start + ' ~ ' + def.end + ' · ' + a.trading_days + ' 日</div></td>' +
                '<td>' + v2Pct(a.total_return, 4) + '<div class="sub">A</div></td>' +
                '<td>' + v2Pct(c.total_return, 4) + '<div class="sub">C</div></td>' +
                '<td>' + v2Pct(a.max_drawdown, 2) + '<div class="sub">A</div></td>' +
                '<td>' + v2Pct(c.max_drawdown, 2) + '<div class="sub">C</div></td>' +
                '<td>' + v2Pct(a.avg_exposure, 2) + '<div class="sub">A</div></td>' +
                '<td>' + v2Pct(c.avg_exposure, 2) + '<div class="sub">C</div></td>' +
                '<td>' + a.held_days + ' / ' + a.trading_days + '<div class="sub">A · ' + fmt.pct(a.held_day_ratio, 2) + '</div></td>' +
                '<td>' + c.held_days + ' / ' + c.trading_days + '<div class="sub">C · ' + fmt.pct(c.held_day_ratio, 2) + '</div></td></tr>';
        }).join('');

        const benchRows = d.benchmarks.new_stage.map(function (b) {
            return '<tr><td><strong>' + esc(b.id) + '</strong></td><td>' + esc(b.label) + '</td><td>' + v2Pct(b.return, 4) + '</td><td>' + v2Pct(b.max_drawdown, 2) + '</td><td>' + (fmt.isNum(b.boundary_value) ? fmt.money(b.boundary_value, 2) : '—') + '</td><td>' + (fmt.isNum(b.end_value) ? fmt.money(b.end_value, 2) : '—') + '</td><td class="text-wrap">' + esc(b.note) + '</td></tr>';
        }).join('');
        const idxRows = d.benchmarks.index_starts.map(function (x) {
            return '<tr><td>' + esc(x.label) + '</td><td>' + v2Pct(x.return, 4) + '</td><td>' + fmt.money(x.start_close, 4) + '</td></tr>';
        }).join('');

        const gateRows = d.validation.gates.map(function (g2) {
            return '<tr><td class="mono">' + esc(g2.id) + '</td><td>' + esc(g2.label) + '</td><td><span class="badge ' + (g2.pass ? 'badge-success' : 'badge-danger') + '">' + (g2.pass ? 'PASS' : 'FAIL') + '</span></td><td class="text-wrap">' + esc(g2.detail || '') + '</td></tr>';
        }).join('');
        const decisionRows = d.decisions.map(function (x) {
            return '<tr><td class="mono">' + esc(x.id) + '</td><td>' + esc(x.label) + '</td><td><span class="badge ' + (x.adopted_as === '未采用' ? 'badge-neutral' : (x.id === 'P20E' ? 'badge-warning' : 'badge-info')) + '">' + esc(x.adopted_as) + '</span></td><td class="text-wrap">' + esc(x.decision) + '</td><td class="text-wrap sub">' + esc(x.evidence) + '</td></tr>';
        }).join('');

        container.innerHTML = v2PageHeader('V2 总览', '开发阶段、新时间段、连续全窗口分开展示；主方案 P12-A_fixed，C 仅对照') +
            '<div class="v2-callout danger"><div class="v2-callout-title">' + esc(d.headline.conclusion) + '</div>' +
            '<div>' + esc(d.headline.sub) + '</div><ul>' + d.headline.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' +
            (p === 'new' ? '<div class="v2-callout warning"><strong>当前只显示新阶段。</strong> 新阶段正收益不能单独作为有效性证据；请同时看连续全窗口 −11.17% 和单票依赖。</div>' : '') +
            '<div class="v2-kpi-grid">' +
            v2Kpi('当前区间收益 · ' + v2PeriodDef(p).label, v2Pct(st.total_return, 4), 'A ' + fmt.money(st.start_equity, 2) + ' → ' + fmt.money(st.end_equity, 2)) +
            v2Kpi('最大回撤', v2Pct(st.max_drawdown, 2), '谷值 ' + esc(st.max_drawdown_trough_date || '—')) +
            v2Kpi('平均资金暴露', v2Pct(st.avg_exposure, 2), '每日 stock MV / equity 的算术平均') +
            v2Kpi('有持仓天数', st.held_days + ' / ' + st.trading_days, fmt.pct(st.held_day_ratio, 2) + '（不是资金暴露）') +
            v2Kpi('买入 / 卖出 / 合计', st.buy_orders + ' / ' + st.sell_orders + ' / ' + (st.buy_orders + st.sell_orders), otherLabel + '：' + otherSt.buy_orders + ' / ' + otherSt.sell_orders + ' / ' + (otherSt.buy_orders + otherSt.sell_orders) + '（对照）') +
            v2Kpi('基准（CSI300 价格）', v2Pct(st.benchmark_return, 4), '不含指数分红；策略为税前总收益') +
            v2Kpi('新阶段单票贡献占净 PnL', v2Pct(d.trades[g].new_stage.top_contribution_share, 2), esc(d.trades[g].new_stage.top_contributor) + '；分母是净 PnL，不是权重；剔除后 ' + fmt.pct(d.trades[g].new_stage.return_excluding_top, 4)) +
            v2Kpi('明确结论', '<span class="v2-kpi-text">数据齐备，交易样本少</span>', 'P20E：' + esc(d.validation.label), 'v2-kpi-wide') +
            '</div>' +
            v2StatsBlock(g, p) +
            '<div class="card"><div class="card-header"><span class="card-title">三个阶段分开看（A 主方案 / C 对照）</span><span class="card-sub">新阶段收益不得覆盖全窗口结论</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>区间</th><th>A 收益</th><th>C 收益</th><th>A 最大回撤</th><th>C 最大回撤</th><th>A 平均暴露</th><th>C 平均暴露</th><th>A 有持仓天数</th><th>C 有持仓天数</th></tr></thead><tbody>' + periodRows + '</tbody></table></div>' +
            '<div class="v2-note">开发阶段 2024-09-02~2026-07-29（460 日）；新时间段 2026-07-30~2026-11-19（75 日）；连续全窗口 2024-09-02~2026-11-19（535 日）。全窗口起点 1,000,000，阶段收益不是把全窗口收益重新起算。</div></div></div>' +
            '<div class="v2-grid-2">' +
            '<div class="card"><div class="card-header"><span class="card-title">归一化权益（区间起点=100）</span></div><div class="card-body"><div class="chart-container" style="height:340px;"><canvas id="v2EquityChart"></canvas></div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">回撤（%）</span></div><div class="card-body"><div class="chart-container" style="height:340px;"><canvas id="v2DrawdownChart"></canvas></div></div></div>' +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">新时间段基准（B0–B3）</span><span class="card-sub">策略为税前总收益；B1 为价格收益</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>ID</th><th>基准</th><th>新阶段收益</th><th>最大回撤</th><th>边界值/点位</th><th>期末值/点位</th><th>说明</th></tr></thead><tbody>' + benchRows + '</tbody></table></div>' +
            '<div class="v2-note">' + esc(d.benchmarks.note) + '</div>' +
            '<div class="table-container" style="margin-top:12px;"><table><thead><tr><th>指数起点</th><th>到 ' + esc(d.periods.full.end) + ' 的价格收益</th><th>起点收盘</th></tr></thead><tbody>' + idxRows + '</tbody></table></div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">验证结论与预注册门槛</span><span class="card-sub">' + esc(d.validation.classification) + '</span></div><div class="card-body">' +
            '<div class="v2-callout warning"><strong>' + esc(d.validation.label) + '</strong>：A 新关闭 episode 1 个，A+C 2 个；低于 A≥2 且 A+C≥5。' + esc(d.validation.gate_note || '') + '</div>' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>门禁</th><th>说明</th><th>结果</th><th>证据</th></tr></thead><tbody>' + gateRows + '</tbody></table></div>' +
            '<div class="v2-note">P12 行为测试 11/11 PASS；mutation 3/3 killed；460 日会计恒等式全部成立。前缀：A strict 不一致（1 个日历投影字段），C strict 一致；经济字段一致，但不宣称严格逐字段一致。</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">版本与采纳状态</span><span class="card-sub">P13 两日确认、P18 估值禁买均未采用</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>版本</th><th>内容</th><th>状态</th><th>Decision</th><th>依据</th></tr></thead><tbody>' + decisionRows + '</tbody></table></div>' +
            '<div class="v2-note"><strong>增长原因：</strong>' + esc(d.growth_reason.label) + '；' + esc(d.growth_reason.status) + '。' + esc(d.growth_reason.reason) + '</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">数据核对与静态边界</span><span class="card-sub">源账本一致性 · 无外部模型</span></div><div class="card-body">' +
            '<div class="v2-kpi-grid">' +
            v2Kpi('核对状态', '<span class="badge ' + (d.reconciliation.status === 'PASS' ? 'badge-success' : 'badge-danger') + '">' + esc(d.reconciliation.status) + '</span>', esc(String(d.reconciliation.passed)) + ' / ' + esc(String(d.reconciliation.check_count)) + ' 项通过') +
            v2Kpi('源文件哈希', fmt.money(d.reconciliation.source_file_count, 0), '冻结产物 SHA-256 记录在 verification/source_hashes.json') +
            v2Kpi('数据截止', esc(d.periods.full.end), '生成 ' + esc(d.generated_at.slice(0, 10))) +
            v2Kpi('页面边界', '<span class="v2-kpi-text">只读本地静态数据</span>', '不加载外部模型 / 自动 AI 服务') +
            '</div><ul class="v2-limits">' + d.reconciliation.key_checks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
            '<div class="v2-note">' + esc(d.reconciliation.note) + '</div></div></div>' +
            v2ScoringAuditCard() +
            '<div class="card"><div class="card-header"><span class="card-title">口径与限制（必须与数字一起读）</span></div><div class="card-body"><ol class="v2-limits">' +
            d.limitations.map(function (l) { return '<li><strong>' + esc(l.title) + '：</strong>' + esc(l.text) + '</li>'; }).join('') +
            '</ol></div></div>';

        bindV2(container);
        drawV2Equity(p);
        drawV2Drawdown(p);
    }

    function renderV2Timeline(container) {
        const d = v2Data();
        const g = state.v2.variant;
        const p = state.v2.period;
        if (!d) {
            container.innerHTML = v2PageHeader('V2 持仓与现金时间线', '逐日持仓、现金与资金暴露') + '<div class="alert alert-warning">暂无数据。</div>';
            return;
        }
        const st = v2Exp(g).periods[p];
        const rows = v2Rows(g, p);
        const devRatio = v2Exp(g).periods.dev.exposure_ratio_of_averages;
        const events = [];
        rows.forEach(function (r) {
            (r.events || []).forEach(function (e) { events.push(Object.assign({ date: r.date }, e)); });
        });
        const pageSize = 25;
        const pages = Math.max(1, Math.ceil(rows.length / pageSize));
        const page = Math.min(Math.max(1, state.v2.timelinePage), pages);
        const pageRows = rows.slice().reverse().slice((page - 1) * pageSize, page * pageSize);

        const eventRows = events.slice().sort(function (a, b) {
            return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
        }).slice(0, 40).map(function (e) {
            return '<div class="v2-event"><span class="v2-event-date mono">' + esc(e.date) + '</span>' +
                v2EventBadge(e.type) + '<span class="v2-event-text">' + v2EventText(e) + '</span></div>';
        }).join('') || '<div class="loading">当前区间无已记录事件</div>';

        const tableRows = pageRows.map(function (r) {
            const ev = (r.events || []).length ? (r.events || []).map(function (e) {
                return v2EventBadge(e.type) + '<span class="sub">' + esc(e.symbol || '') + '</span>';
            }).join(' ') : '<span class="muted">—</span>';
            return '<tr' + ((r.events || []).length ? ' class="v2-event-row"' : '') + '>' +
                '<td class="mono">' + esc(r.date) + '</td>' +
                '<td class="mono">' + fmt.money(r.equity, 2) + '</td>' +
                '<td class="mono">' + fmt.money(r.cash, 2) + '</td>' +
                '<td class="mono">' + fmt.pct(r.cash_ratio, 2) + '</td>' +
                '<td class="mono">' + fmt.money(r.market_value, 2) + '</td>' +
                '<td class="mono">' + fmt.pct(r.exposure, 2) + '</td>' +
                '<td class="mono">' + r.position_count + '</td>' +
                '<td class="mono">' + v2Pct(r.daily_return, 4) + '</td>' +
                '<td class="mono">' + v2Pct(r.cumulative_return, 2) + '</td>' +
                '<td>' + ev + '</td></tr>';
        }).join('');

        container.innerHTML = v2PageHeader('V2 持仓与现金时间线', '每天展示持仓数量、股票市值占总权益、现金占比；买卖与重要复评单独标记') +
            '<div class="v2-kpi-grid">' +
            v2Kpi('有持仓天数', st.held_days + ' / ' + st.trading_days, fmt.pct(st.held_day_ratio, 2), '') +
            v2Kpi('平均资金暴露', v2Pct(st.avg_exposure, 2), '每日股票市值 / 总权益的算术平均') +
            v2Kpi('平均现金占比', v2Pct(st.avg_cash_ratio, 2), '每日现金 / 总权益') +
            v2Kpi('期末现金占比', rows.length ? fmt.pct(rows[rows.length - 1].cash_ratio, 2) : '暂无数据', rows.length ? '期末现金 ' + fmt.money(rows[rows.length - 1].cash, 2) : '') +
            v2Kpi('有持仓天数 ≠ 资金暴露', '<span class="v2-kpi-text">两个口径分开</span>', '持仓天数是有无持仓；暴露是每天仓位/权益') +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">股票暴露与现金占比</span><span class="card-sub">细线：买入/卖出/退出复评事件</span></div><div class="card-body"><div class="chart-container" style="height:360px;"><canvas id="v2TimelineChart"></canvas></div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">重要事件（最近 40 条）</span><span class="card-sub">买入、卖出、退出复评、恢复复评</span></div><div class="card-body"><div class="v2-event-list">' + eventRows + '</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">逐日明细</span><span class="card-sub">金额为元；单日收益与累计收益分列</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>日期</th><th>总权益</th><th>现金</th><th>现金/权益</th><th>股票市值</th><th>股票/权益</th><th>持仓数</th><th>单日收益</th><th>累计收益</th><th>事件</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
            v2Pager(rows.length, page, pageSize, 'data-v2-timeline-page') +
            '<div class="v2-note">口径补充：开发阶段 P12 报告中的平均资金暴露 ' + fmt.pct(devRatio, 2) + ' 是“平均股票市值 / 平均权益”（ratio of averages）；本页平均资金暴露 ' + fmt.pct(v2Exp(g).periods.dev.avg_exposure, 2) + ' 是“每日 market_value / equity 的算术平均”。两者不同，不能混用。</div></div></div>';

        bindV2(container);
        drawV2Timeline(p);
    }

    function renderV2Why(container) {
        const d = v2Data();
        const g = state.v2.variant;
        const p = state.v2.period;
        if (!d) {
            container.innerHTML = v2PageHeader('V2 为什么没有买入', '逐日真实漏斗与拒绝原因') + '<div class="alert alert-warning">暂无数据。</div>';
            return;
        }
        const f = d.why_not_buy[g][p];
        const reasons = Object.keys(f.reason_counts || {}).sort(function (a, b) { return f.reason_counts[b] - f.reason_counts[a]; });
        const reasonRows = reasons.map(function (k) {
            return '<tr><td class="mono">' + esc(k) + '</td><td>' + esc(V2_REASON_LABELS[k] || k) + '</td><td class="mono">' + fmt.money(f.reason_counts[k], 0) + '</td></tr>';
        }).join('') || '<tr><td colspan="3">' + naCell('新阶段扩展账本未保存逐票 permission reasons，无法重建') + '</td></tr>';
        const groupRows = ['market', 'sector', 'price'].map(function (k) {
            const label = k === 'market' ? '市场' : (k === 'sector' ? '板块' : '价格');
            const val = f.detail_available ? '<span class="mono">' + fmt.money(f.reason_groups[k] || 0, 0) + '</span>' : naInline('无逐票明细');
            return '<tr><td>' + label + '</td><td>' + val + '</td><td class="sub">原因计数；同一符号日可重复触发，不可相加成拒绝数</td></tr>';
        }).join('');
        const overlapRows = Object.keys(f.reason_overlap_rows || {}).sort().map(function (n) {
            return '<tr><td>' + esc(n) + ' 个原因</td><td class="mono">' + fmt.money(f.reason_overlap_rows[n], 0) + '</td></tr>';
        }).join('');
        const gaps = d.why_not_buy[g].gaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');

        const pageSize = 20;
        const pages = Math.max(1, Math.ceil(f.daily.length / pageSize));
        const page = Math.min(Math.max(1, state.v2.whyPage), pages);
        const dailyRows = f.daily.slice().reverse().slice((page - 1) * pageSize, page * pageSize).map(function (x) {
            return '<tr><td class="mono">' + esc(x.date) + '</td><td class="mono">' + x.evaluable + '</td><td class="mono">' + x.financial_passed + '</td><td class="mono">' + x.permission_passed + '</td><td class="mono">' + x.new_candidates + '</td><td class="mono">' + x.buy_intents + '</td><td class="mono">' + x.deferred_no_seat + '</td><td class="mono">' + x.not_ranked + '</td></tr>';
        }).join('');

        container.innerHTML = v2PageHeader('V2 为什么没有买入', '只使用每日真实漏斗；重叠原因不可相加，缺少记录明确标注不可重建') +
            (p === 'new' ? '<div class="v2-callout warning"><strong>新阶段明细不完整：</strong>扩展账本只保存每日计数，没有逐票 permission reasons、逐票财务拒绝原因；缺失部分无法重建。页面只展示可核对的计数。</div>' : '') +
            '<div class="v2-kpi-grid">' +
            v2Kpi('财务拒绝（符号日）', fmt.money(f.financial_rejected_symbol_days, 0), '可评估 − 财务通过', '') +
            v2Kpi('权限拒绝（符号日）', fmt.money(f.permission_rejected_symbol_days, 0), '财务通过 − 权限通过') +
            v2Kpi('新候选实例', fmt.money(f.new_candidate_instances, 0), '通过观察/持有条件后') +
            v2Kpi('买入意图', fmt.money(f.buy_intents, 0), '意图不等于成交') +
            v2Kpi('席位延后', fmt.money(f.deferred_no_seat, 0), '满 5 席时等待') +
            v2Kpi('排序层未排', fmt.money(f.not_ranked, 0), '财务底线/排序条件，不等于财务硬门槛') +
            '</div>' +
            '<div class="v2-callout info"><strong>不可相加：</strong>同一符号日可能同时有市场、板块、价格多个拒绝原因；原因计数总和大于被拒符号日数。全市场 1,932 只中只有 16 只进入财务研究样本，这是研究切片，不是策略拒绝。</div>' +
            '<div class="v2-grid-2">' +
            '<div class="card"><div class="card-header"><span class="card-title">漏斗（符号日 / 实例）</span></div><div class="card-body"><div class="chart-container" style="height:300px;"><canvas id="v2FunnelChart"></canvas></div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">每日通过 / 候选</span></div><div class="card-body"><div class="chart-container" style="height:300px;"><canvas id="v2FunnelDailyChart"></canvas></div></div></div>' +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">漏斗阶段与对账</span></div><div class="card-body"><div class="table-container"><table class="matrix-table"><thead><tr><th>阶段</th><th>值</th><th>说明</th></tr></thead><tbody>' +
            '<tr><td>研究池（每日）</td><td class="mono">' + fmt.money(f.pool_size, 0) + '</td><td class="sub">全市场研究池</td></tr>' +
            '<tr><td>财务样本（每日）</td><td class="mono">' + fmt.money(f.financial_sample_size, 0) + '</td><td class="sub">固定 16 只，不是拒绝</td></tr>' +
            '<tr><td>可评估符号日</td><td class="mono">' + fmt.money(f.evaluable_symbol_days, 0) + '</td><td class="sub">财务样本 × 交易日</td></tr>' +
            '<tr><td>财务通过</td><td class="mono">' + fmt.money(f.financial_passed_symbol_days, 0) + '</td><td class="sub">财务硬门槛通过</td></tr>' +
            '<tr><td>权限通过</td><td class="mono">' + fmt.money(f.permission_passed_symbol_days, 0) + '</td><td class="sub">市场 + 板块 + 价格 + 财务</td></tr>' +
            '<tr><td>新候选</td><td class="mono">' + fmt.money(f.new_candidate_instances, 0) + '</td><td class="sub">未持有/未冷却</td></tr>' +
            '<tr><td>买入意图</td><td class="mono">' + fmt.money(f.buy_intents, 0) + '</td><td class="sub">意图，不等于成交</td></tr>' +
            '<tr><td>席位延后</td><td class="mono">' + fmt.money(f.deferred_no_seat, 0) + '</td><td class="sub">满席等待</td></tr>' +
            '<tr><td>排序层未排</td><td class="mono">' + fmt.money(f.not_ranked, 0) + '</td><td class="sub">财务底线/排序条件</td></tr>' +
            '<tr><td>未成为新候选</td><td class="mono">' + fmt.money(f.non_candidate_after_permission, 0) + '</td><td class="sub">权限通过但未形成新候选；原因未逐条保存</td></tr>' +
            '</tbody></table></div>' +
            '<div class="v2-note">候选对账（当前方案）：' + fmt.money(f.new_candidate_instances, 0) + ' = 意图 ' + fmt.money(f.buy_intents, 0) + ' + 席位延后 ' + fmt.money(f.deferred_no_seat, 0) + ' + 排序层未排 ' + fmt.money(f.not_ranked, 0) + '。</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">拒绝原因（开发阶段逐票 permission 审计）</span><span class="card-sub">' + (f.detail_available ? '可用' : '新阶段无逐票明细') + '</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>原因代码</th><th>中文</th><th>出现次数</th></tr></thead><tbody>' + reasonRows + '</tbody></table></div>' +
            '<div class="v2-grid-2" style="margin-top:12px;"><div class="table-container"><table><thead><tr><th>原因组</th><th>次数</th><th>口径</th></tr></thead><tbody>' + groupRows + '</tbody></table></div>' +
            '<div class="table-container"><table><thead><tr><th>每个被拒符号日的原因数</th><th>行数</th></tr></thead><tbody>' + (overlapRows || '<tr><td colspan="2">' + naCell('新阶段无逐票明细') + '</td></tr>') + '</tbody></table></div></div>' +
            '<div class="v2-note">这些是 permission 检查的原因计数，且只覆盖开发阶段 460 日逐票审计；新阶段的 ' + fmt.money(d.why_not_buy[g].new.permission_rejected_symbol_days, 0) + ' 个权限拒绝没有逐票原因，未计入此表。“财务拒绝”也不在这里逐项展开，因为账本只保存财务通过/不通过，未保存每只股票的失败 metric。</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">缺失记录与不可重建项</span></div><div class="card-body"><ul class="v2-limits">' + gaps + '</ul></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">每日漏斗</span></div><div class="card-body"><div class="table-container"><table class="matrix-table"><thead><tr><th>日期</th><th>可评估</th><th>财务通过</th><th>权限通过</th><th>新候选</th><th>意图</th><th>席位延后</th><th>未排</th></tr></thead><tbody>' + dailyRows + '</tbody></table></div>' +
            v2Pager(f.daily.length, page, pageSize, 'data-v2-why-page') + '</div></div>';

        bindV2(container);
        drawV2Funnel(p);
    }

    function renderV2Trades(container) {
        const d = v2Data();
        const g = state.v2.variant;
        const p = state.v2.period;
        if (!d) {
            container.innerHTML = v2PageHeader('V2 交易与贡献', '卖出净盈亏与阶段贡献') + '<div class="alert alert-warning">暂无数据。</div>';
            return;
        }
        const t = d.trades[g];
        const st = v2Exp(g).periods[p];
        const def = v2PeriodDef(p);
        const symbols = Array.from(new Set(t.sells.map(function (s) { return s.symbol; }))).sort();
        let sells = t.sells.filter(function (s) {
            return s.fill_date >= def.start && s.fill_date <= def.end;
        });
        if (state.v2.tradeSymbol) {
            sells = sells.filter(function (s) { return s.symbol === state.v2.tradeSymbol; });
        }
        const sort = state.v2.tradeSort;
        sells = sells.slice().sort(function (a, b) {
            let av = a[sort.column];
            let bv = b[sort.column];
            if (av === null || av === undefined) av = '';
            if (bv === null || bv === undefined) bv = '';
            if (typeof av === 'number' && typeof bv === 'number') return sort.direction === 'asc' ? av - bv : bv - av;
            return sort.direction === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
        const pageSize = 20;
        const pages = Math.max(1, Math.ceil(sells.length / pageSize));
        const page = Math.min(Math.max(1, state.v2.tradePage), pages);
        const pageSells = sells.slice((page - 1) * pageSize, page * pageSize);

        const newStage = t.new_stage;
        const contribRows = newStage.contributions.map(function (x) {
            const fullCycle = t.sells.filter(function (s) {
                return s.symbol === x.symbol && s.period === 'new';
            }).reduce(function (acc, s) { return acc + s.net_pnl; }, 0);
            return '<tr><td class="mono">' + esc(x.symbol) + '</td>' +
                '<td class="mono">' + fmt.money(x.boundary_market_value, 2) + '</td>' +
                '<td class="mono">' + fmt.money(x.end_market_value, 2) + '</td>' +
                '<td class="mono">' + fmt.money(x.buy_cash_out, 2) + '</td>' +
                '<td class="mono">' + fmt.money(x.sell_net_proceeds, 2) + '</td>' +
                '<td class="mono">' + fmt.money(x.dividends, 2) + '</td>' +
                '<td class="mono">' + v2SignedMoney(x.contribution, 2) + '</td>' +
                '<td class="mono">' + (fmt.isNum(x.share_of_new_stage_net_pnl) ? fmt.pct(x.share_of_new_stage_net_pnl, 2) : '暂无数据') + '</td>' +
                '<td class="sub">' + (x.uses_boundary_market_value ? '从边界市值起算' : '新买入；无边界持仓') + '</td></tr>';
        }).join('');
        const sellRows = pageSells.map(function (s) {
            return '<tr><td class="mono">' + esc(s.symbol) + '</td><td class="mono">' + esc(s.entry_date) + '</td>' +
                '<td class="mono">' + esc(s.fill_date) + '</td><td class="mono">' + esc(s.signal_date || '—') + '</td>' +
                '<td class="mono">' + (fmt.isNum(s.holding_trading_days) ? s.holding_trading_days : naInline('缺少交易日历索引')) + '</td>' +
                '<td class="mono">' + fmt.money(s.quantity, 0) + '</td>' +
                '<td class="mono">' + v2SignedMoney(s.net_pnl, 2) + '</td>' +
                '<td class="mono">' + v2SignedPct(s.net_return, 4, '分母缺失或为0') + '</td>' +
                '<td class="mono">' + v2SignedMoney(s.cumulative_realized_pnl, 2) + '</td>' +
                '<td class="sub text-wrap">' + esc(s.reason || '') + '<div class="sub">cycle ' + esc(s.cycle_id === null || s.cycle_id === undefined ? '—' : s.cycle_id) + ' · 费用 ' + fmt.money(s.fees, 2) + '</div></td></tr>';
        }).join('') || '<tr><td colspan="10">' + naCell('该区间/筛选无卖出成交') + '</td></tr>';
        const divRows = t.dividends_by_symbol.map(function (x) {
            return '<tr><td class="mono">' + esc(x.symbol) + '</td><td class="mono">' + fmt.money(x.dividends, 2) + '</td><td class="mono">' + x.pay_events + '</td></tr>';
        }).join('') || '<tr><td colspan="3">' + naCell('全窗口无现金分红入账') + '</td></tr>';
        const weight = st.max_single_weight_of_total_equity_detail || {};
        const boundaryContrib = newStage.contributions.filter(function (x) { return x.uses_boundary_market_value; })[0];
        const boundarySell = boundaryContrib ? t.sells.filter(function (s) { return s.symbol === boundaryContrib.symbol && s.period === 'new'; })[0] : null;
        const boundaryNote = g === 'A' && boundaryContrib ? '<div class="v2-callout warning"><strong>边界持仓：</strong>' + esc(boundaryContrib.symbol) + ' 在 2026-07-29 已持有 28,900 股，边界市值 ' + fmt.money(boundaryContrib.boundary_market_value, 2) + '。新阶段贡献 ' + fmt.money(boundaryContrib.contribution, 2) + ' 从边界市值起算（阶段收益率 ' + fmt.pct(boundaryContrib.stage_return_on_boundary_value, 4) + ' = ' + fmt.money(boundaryContrib.contribution, 2) + ' / ' + fmt.money(boundaryContrib.boundary_market_value, 2) + '）；该次卖出相对全周期成本的净盈亏是 ' + fmt.money(boundarySell ? boundarySell.net_pnl : null, 2) + '，全周期净收益率 ' + fmt.pct(boundarySell ? boundarySell.net_return : null, 4) + '。不能拿全持仓周期收益充当阶段收益。</div>' : '<div class="v2-callout info"><strong>对照 C：</strong>2026-07-29 边界为空仓；新阶段 605138.SH 为 2026-08-28 新买入，阶段贡献 ' + fmt.money(newStage.net_pnl, 2) + ' 与全周期卖出净盈亏相同。</div>';

        container.innerHTML = v2PageHeader('V2 交易与贡献', '成交统计、买入/卖出日期、持仓周期、净盈亏与阶段贡献') +
            v2StatsBlock(g, p) +
            '<div class="v2-kpi-grid">' +
            v2Kpi('卖出成交（当前区间）', fmt.money(sells.length, 0), 'A 全窗口 20 / 新阶段 2') +
            v2Kpi('卖出净盈亏（当前区间）', v2SignedMoney(sells.reduce(function (a, s) { return a + s.net_pnl; }, 0), 2), '已扣卖出费用') +
            v2Kpi('新阶段净盈亏', v2SignedMoney(newStage.net_pnl, 2), '边界权益 → 期末权益') +
            v2Kpi('新阶段贡献合计', v2SignedMoney(newStage.contribution_sum, 2), '残差 ' + fmt.money(newStage.residual, 2)) +
            v2Kpi('最大单票贡献占比', v2Pct(newStage.top_contribution_share, 2), '分母是新阶段净 PnL，不是权重') +
            v2Kpi('分红（全窗口，税前）', fmt.money(t.dividends_total, 2), '不并入卖出净盈亏') +
            '</div>' +
            boundaryNote +
            v2HoldingCyclesTable(g, p) +
            '<div class="v2-grid-2">' +
            '<div class="card"><div class="card-header"><span class="card-title">新阶段分股票贡献与对账</span><span class="card-sub">边界市值 + 新现金流 + 分红</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>股票</th><th>边界市值</th><th>期末市值</th><th>新买入现金流出</th><th>卖出净回款</th><th>分红</th><th>阶段贡献</th><th>占净 PnL</th><th>口径</th></tr></thead><tbody>' + contribRows + '</tbody></table></div>' +
            '<div class="v2-note">对账：分票贡献合计 ' + fmt.money(newStage.contribution_sum, 2) + ' = 阶段净盈亏 ' + fmt.money(newStage.net_pnl, 2) + '，残差 ' + fmt.money(newStage.residual, 2) + '。贡献 = 期末市值 − 边界市值 + 卖出净回款 − 新买入现金流出 + 分红。</div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">贡献柱状图</span></div><div class="card-body"><div class="chart-container" style="height:300px;"><canvas id="v2ContributionChart"></canvas></div></div></div>' +
            '</div>' +
            '<div class="v2-callout warning"><strong>118.24% 的分母：</strong>605138.SH 新阶段贡献 ' + fmt.money(newStage.top_contribution, 2) + ' / 新阶段净 PnL ' + fmt.money(newStage.net_pnl, 2) + ' = ' + fmt.pct(newStage.top_contribution_share, 2) + '。这是净盈亏分母下的归因，不代表持仓权重。剔除该票后 ' + v2Pct(newStage.return_excluding_top, 4) + ' 是算术剔除，不是重新回测。</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">最大单票权重的两个分母</span><span class="card-sub">P20E 的 100% 是股票资产内部占比</span></div><div class="card-body"><div class="v2-grid-2">' +
            '<div class="v2-mini-stat"><div class="v2-kpi-label">股票资产内部最大单票占比</div><div class="v2-kpi-value">' + v2Pct(st.max_single_weight_within_stock_assets, 2) + '</div><div class="v2-kpi-sub">分母 = 当日股票市值合计；只有一只股票时必然 100%</div></div>' +
            '<div class="v2-mini-stat"><div class="v2-kpi-label">占组合总权益最大单票占比</div><div class="v2-kpi-value">' + v2Pct(st.max_single_weight_of_total_equity, 2) + '</div><div class="v2-kpi-sub">分母 = 总权益；' + esc(weight.date || '—') + ' ' + esc(weight.symbol || '') + '，市值 ' + fmt.money(weight.market_value, 2) + ' / 权益 ' + fmt.money(weight.equity, 2) + '</div></div>' +
            '</div><div class="v2-note">两个比例不能混用；页面上任何“最大单票权重”都必须带分母说明。</div></div></div>' +
            v2TradeNotesCards() +
            v2ScoringAuditCard() +
            '<div class="card"><div class="card-header"><span class="card-title">卖出明细</span><span class="card-sub">排序、筛选；累计已实现自 2024-09-02 起</span></div><div class="card-body">' +
            '<div class="filter-bar"><div class="filter-group"><label>股票</label><select id="v2SymbolFilter"><option value="">全部</option>' +
            symbols.map(function (s) { return '<option value="' + esc(s) + '"' + (state.v2.tradeSymbol === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
            '<div class="filter-group"><label>区间</label><span class="v2-inline-value">' + esc(def.label) + ' · ' + esc(def.start) + ' ~ ' + esc(def.end) + '</span><span class="sub">按卖出成交日（fill_date）筛选</span></div></div>' +
            '<div class="table-container"><table class="matrix-table" id="v2SellTable"><thead><tr>' +
            v2SortHeader('股票', 'symbol') + '<th>买入成交日</th>' + v2SortHeader('卖出成交日', 'fill_date') + '<th>卖出信号日</th>' + v2SortHeader('持有交易日', 'holding_trading_days') + '<th>数量</th>' + v2SortHeader('净盈亏', 'net_pnl') + v2SortHeader('净收益率', 'net_return') + '<th>累计已实现</th><th>原因 / 周期</th></tr></thead><tbody>' + sellRows + '</tbody></table></div>' +
            v2Pager(sells.length, page, pageSize, 'data-v2-trade-page') +
            '<div class="v2-note">买入成交日与卖出成交日分列；卖出信号日单独列，不与成交日混用。净收益率 = 卖出净盈亏 / 买入总成本；持有交易日按交易日历索引差；累计已实现为组合自 2024-09-02 起的累计值，不是单日收益。筛选后记录数 ' + sells.length + ' 条，与区间成交总数分列显示。</div></div></div>' +
            '<div class="v2-grid-2">' +
            '<div class="card"><div class="card-header"><span class="card-title">区间内累计已实现净盈亏</span></div><div class="card-body"><div class="chart-container" style="height:300px;"><canvas id="v2CumulativeChart"></canvas></div></div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">分红（全窗口，税前）</span><span class="card-sub">分红现金不并入卖出净盈亏</span></div><div class="card-body"><div class="table-container"><table><thead><tr><th>股票</th><th>分红现金</th><th>支付事件</th></tr></thead><tbody>' + divRows + '</tbody></table></div><div class="v2-note">分红为税前；post_tax_return_verified=false。</div></div></div>' +
            '</div>';

        bindV2(container);
        drawV2Cumulative(p);
        drawV2Contribution(g);
    }


    const renderers = {
        overview: renderOverview,
        nav: renderNav,
        comparison: renderComparison,
        segments: renderSegments,
        trades: renderTrades,
        v2_overview: renderV2Overview,
        v2_timeline: renderV2Timeline,
        v2_why: renderV2Why,
        v2_trades: renderV2Trades,
        riskfix: renderRiskFix,
        concentration: renderConcentration,
        cost: renderCostAttribution,
        behaviour: renderBehaviour,
        quality: renderQuality,
        v2: renderV2P2,
        history: renderHistory,
        feedback: renderFeedbackPage
    };

    function renderPage(page) {
        destroyCharts();
        const renderer = renderers[page];
        els.mainContent.innerHTML = '<div class="page active" id="page-' + page + '"></div>';
        const target = document.getElementById('page-' + page);
        if (renderer) {
            renderer(target);
        } else {
            target.innerHTML = '<div class="alert alert-info">页面不存在</div>';
        }
    }

    function sectionHeader(title, subtitle) {
        return '<div class="section-header"><div><h1 class="section-title">' + esc(title) + '</h1>' +
            '<p class="section-subtitle">' + esc(subtitle) + '</p></div></div>';
    }

    function experimentBanner(exp) {
        const avail = exp.availability;
        const mark = function (ok) { return ok ? '<span class="ok">可用</span>' : '<span class="miss">缺失</span>'; };
        return '<div class="experiment-banner">' +
            '<div class="exp-line"><span class="exp-kicker">当前实验</span><strong id="activeExperimentLabel">' + esc(exp.label) + '</strong>' +
            '<span class="badge ' + (exp.implementation === 'fixed' ? 'badge-warning' : 'badge-neutral') + '">' + esc(exp.implementation) + '</span>' +
            '<span class="badge badge-info">' + esc(exp.group) + '</span>' +
            '<span class="badge badge-neutral">' + esc(exp.cost_scenario) + '</span></div>' +
            '<div class="exp-meta">数据区间 ' + esc(exp.window.start) + ' ~ ' + esc(exp.window.end) +
            ' · 初始资金 ' + (fmt.isNum(exp.initial_equity) ? fmt.money(exp.initial_equity, 2) : '暂无数据') +
            ' · 来源 ' + esc(exp.source.summary) + '</div>' +
            '<div class="exp-meta">可用状态：汇总 ' + mark(avail.summary) + ' · 净值曲线 ' + mark(avail.equity_curve) +
            ' · 交易明细 ' + mark(avail.trades) + ' · 分段 ' + mark(avail.segments) + '</div>' +
            '</div>';
    }

    function snapshotTable(contractObj, highlightId) {
        const rows = contractObj.experiments.map(function (e) {
            const isActive = e.id === highlightId;
            return '<tr' + (isActive ? ' class="active-row"' : '') + '>' +
                '<td><span class="mono">' + esc(e.id) + '</span></td>' +
                '<td>' + esc(e.label) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_03_18) ? fmt.money(e.equity_2026_03_18, 6) : naInline('缺 2026-03-18 权益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_07_29) ? fmt.money(e.equity_2026_07_29, 6) : naInline('缺期末权益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.total_return) ? fmt.pct(e.total_return, 2) : naInline('缺总收益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.new_90d_return) ? fmt.pct(e.new_90d_return, 4) : naInline('缺新90日收益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.max_drawdown) ? fmt.pct(e.max_drawdown, 2) : naInline('缺净值曲线')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.risk_three_layer_sells) ? String(e.risk_three_layer_sells) : naInline('缺卖出原因')) + '</td>' +
                '</tr>';
        }).join('');
        return '<div class="table-container"><table class="matrix-table">' +
            '<thead><tr><th>实验ID</th><th>实验</th><th>2026-03-18 权益</th><th>2026-07-29 权益</th>' +
            '<th>总收益</th><th>新90日收益</th><th>最大回撤</th><th>风险三层卖出</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>';
    }

    function naInline(reason) {
        return '<span class="na" title="' + esc(reason) + '">暂无数据</span>';
    }

    function firstRiskText(exp) {
        if (!exp.availability.trades) return naInline('缺少该实验交易明细');
        if (!fmt.isNum(exp.risk_three_layer_sells) || exp.risk_three_layer_sells === 0) {
            return absentZero('无 risk_three_layer 卖出（全区间 0 笔）');
        }
        const t = exp.first_risk_trade;
        if (!t) return naInline('缺少首笔风险成交明细');
        return '<span class="mono">' + esc(t.symbol) + '</span><span class="sub">signal ' +
            esc(t.signal_date || '-') + ' · fill ' + esc(t.fill_date || t.trade_date || '-') + '</span>';
    }

    function renderOverview(container) {
        const c = contract();
        const exp = currentExperiment();
        const man = state.data.manifest || {};
        const st = state.data.d2c_status || {};
        const dq = state.data.data_quality || {};
        const flags = man.provisional_flags || {};
        const statusText = function (ok, good, bad) {
            return ok ? (good || '已验证') : (bad || '未验证');
        };
        const gate = st.old_370d_reproduction_gate || {};
        const identityOk = exp.asset_identity_breaks === 0;

        container.innerHTML = sectionHeader('实验总览 · ' + exp.label,
            '统一数据契约（schema ' + c.schema_version + '）· 四组实验 Original/Fixed × C/R') +
            experimentBanner(exp) +
            '<div class="metric-grid">' +
            metricCard('期末权益（2026-07-29）', moneyCell(metric(exp.final_equity, '缺少期末权益字段', { dp: 6 })), 'mono') +
            metricCard('总收益', pctCell(metric(exp.total_return, '缺少总收益字段', { dp: 2 }))) +
            metricCard('2026-03-18 权益', moneyCell(metric(exp.equity_2026_03_18, '缺少 2026-03-18 权益', { dp: 6 }))) +
            metricCard('新90日收益（本组 0318 权益为分母）', pctCell(metric(exp.new_90d_return, '缺少 2026-03-18 或 2026-07-29 权益', { dp: 4 }))) +
            metricCard('新90日基准', pctCell(metric(c.benchmark_new_window.value, c.benchmark_new_window.reason, { dp: 6 }))) +
            metricCard('新90日超额', pctCell(metric(exp.new_90d_excess, '缺少新90日收益或基准', { dp: 4 }))) +
            metricCard('最大回撤', pctCell(metric(exp.max_drawdown, '缺少该实验净值曲线', { dp: 2 }))) +
            metricCard('交易笔数', countCell(metric(exp.trade_count, '缺少交易明细'))) +
            metricCard('首笔风险成交', firstRiskText(exp)) +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">实验契约字段</span>' +
            '<span class="card-sub">单页读取同一契约，不经页面各自猜测字段</span></div><div class="card-body">' +
            '<div class="table-container"><table>' +
            '<thead><tr><th>字段</th><th>取值</th><th>来源</th></tr></thead><tbody>' +
            '<tr><td>稳定实验ID</td><td class="mono">' + esc(exp.id) + '</td><td>' + esc(exp.source.summary) + '</td></tr>' +
            '<tr><td>实现版本</td><td>' + esc(exp.implementation_label) + '</td><td class="mono">experiments.json#' + esc(exp.group) + '</td></tr>' +
            '<tr><td>实验组 / 成本情景</td><td>' + esc(exp.group_label) + ' / ' + esc(exp.cost_scenario) + '</td><td class="mono">experiments.json#' + esc(exp.group) + '</td></tr>' +
            '<tr><td>数据区间 / 交易日</td><td class="mono">' + esc(exp.window.start) + ' ~ ' + esc(exp.window.end) + ' / ' + (fmt.isNum(exp.trade_days) ? exp.trade_days + ' 日' : '暂无数据') + '</td><td class="mono">experiments.json#' + esc(exp.group) + '</td></tr>' +
            '<tr><td>初始资金</td><td class="mono">' + (fmt.isNum(exp.initial_equity) ? fmt.money(exp.initial_equity, 2) : '暂无数据') + '</td><td>' + esc(exp.source.summary) + '</td></tr>' +
            '<tr><td>总收益 / 期末权益</td><td class="mono">' + (fmt.isNum(exp.total_return) ? fmt.pct(exp.total_return, 2) : '暂无数据') + ' / ' + (fmt.isNum(exp.final_equity) ? fmt.money(exp.final_equity, 6) : '暂无数据') + '</td><td>' + esc(exp.source.summary) + '</td></tr>' +
            '<tr><td>净值曲线 / 交易明细</td><td>' + esc(exp.availability_detail.equity_curve) + ' / ' + esc(exp.availability_detail.trades) + '</td><td class="mono">' + esc(exp.source.equity_curve) + ' · ' + esc(exp.source.trades) + '</td></tr>' +
            '<tr><td>基准新90日</td><td class="mono">' + (fmt.isNum(c.benchmark_new_window.value) ? fmt.pct(c.benchmark_new_window.value, 6) : '暂无数据') + '</td><td>' + esc(c.benchmark_new_window.source || '暂无数据') + '</td></tr>' +
            '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">四组实验快照</span>' +
            '<span class="card-sub">高亮行 = 当前选中实验</span></div><div class="card-body">' + snapshotTable(c, exp.id) + '</div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">状态卡</span></div><div class="card-body">' +
            '<div class="status-grid">' +
            statusCard(gate.C && gate.R ? 'verified' : 'pending', '旧370日复现', statusText(gate.C && gate.R, '逐值一致', '见详情'), '信号/候选顺序/交易流/每日净值/期末持仓一致') +
            statusCard('verified', '连续回测', '已验证', '无清仓、无资金重置、T+1、100股整手') +
            statusCard(identityOk ? 'verified' : 'blocked', '资产恒等', identityOk ? '已验证' : '存在断裂', '现金+市值=权益（该实验断裂数 ' + (fmt.isNum(exp.asset_identity_breaks) ? exp.asset_identity_breaks : '暂无数据') + '）') +
            statusCard('blocked', 'Raw Execution', flags.raw_execution ? '未完成' : '已完成', '真实成交价核算状态见 manifest') +
            statusCard('blocked', '公司行为会计', flags.corporate_actions ? '未完成' : '已完成', '分红/拆股/配股') +
            statusCard('blocked', '财务覆盖', flags.financial_coverage ? '不足' : '充足', '评分为 6 只样本，按正式规则降级') +
            statusCard('pending', '风险修复状态', exp.implementation === 'fixed' ? '映射已修复' : '含确认缺陷', exp.risk_fix_metadata ? exp.risk_fix_metadata.defect_fixed : '见风险修复实验页') +
            '</div></div></div>' +
            '<div class="alert alert-warning" style="margin-top:16px;"><strong>重要提示：</strong> 当前结果用于策略实验和行为验证，不构成投资建议，不授权模拟盘或实盘。收益基于 <code>adjusted_virtual</code> 价格空间，数量采用 100 股整手近似。</div>' +
            '<div class="alert alert-info" style="margin-top:12px;"><strong>数据说明：</strong> 缺失字段一律显示“暂无数据”并注明原因，不填 0；真实 0 会正常显示为 0。当前数据截止 ' +
            esc(man.data_as_of || dq.data_date_range || '暂无数据') + '。</div>';
    }

    function metricCard(label, valueHtml, extraClass) {
        return '<div class="metric-card"><div class="metric-label">' + esc(label) + '</div>' +
            '<div class="metric-value ' + (extraClass || '') + '">' + valueHtml + '</div></div>';
    }

    function statusCard(cls, title, value, sub) {
        return '<div class="status-card ' + cls + '"><div class="status-card-title">' + esc(title) + '</div>' +
            '<div class="status-card-value">' + esc(value) + '</div>' +
            '<div class="status-card-sub">' + esc(sub) + '</div></div>';
    }

    function renderNav(container) {
        const exp = currentExperiment();
        if (!exp.availability.equity_curve) {
            container.innerHTML = sectionHeader('净值与回撤', '曲线数据缺失') + experimentBanner(exp) +
                '<div class="alert alert-warning">' + naCell(exp.availability_detail.equity_curve) + '</div>';
            return;
        }
        container.innerHTML = sectionHeader('净值与回撤 · ' + exp.label,
            '主图为当前实验自身净值与沪深300基准；下方对比图为四组实验') +
            experimentBanner(exp) +
            '<div class="filter-bar" id="navFilters">' +
            '<div class="filter-group"><label>时间范围</label><select id="navPeriod">' +
            '<option value="full">全区间 2024-09-02 ~ 2026-07-29</option>' +
            '<option value="old280">旧280日 2024-09-02 ~ 2025-10-31</option>' +
            '<option value="old370">旧370日 2024-09-02 ~ 2026-03-18</option>' +
            '<option value="new90">新90日 2026-03-19 ~ 2026-07-29</option>' +
            '<option value="custom">自定义</option></select></div>' +
            '<div class="filter-group" id="customDateFrom" style="display:none;"><label>起始日期</label><input type="date" id="navDateFrom"></div>' +
            '<div class="filter-group" id="customDateTo" style="display:none;"><label>结束日期</label><input type="date" id="navDateTo"></div>' +
            '<div class="filter-group"><label>显示</label><select id="navSeries">' +
            '<option value="all">全部系列</option><option value="equity">仅净值</option><option value="drawdown">仅回撤</option></select></div>' +
            '<button class="btn btn-secondary btn-sm" id="resetZoomBtn">重置缩放</button>' +
            '</div>' +
            '<div class="metric-grid compact">' +
            metricCard('当前实验期末权益（2026-07-29）', moneyCell(metric(exp.equity_2026_07_29, '暂无数据', { dp: 6 }))) +
            metricCard('当前实验总收益', pctCell(metric(exp.total_return, '暂无数据', { dp: 2 }))) +
            metricCard('当前实验最大回撤', pctCell(metric(exp.max_drawdown, '暂无数据', { dp: 2 }))) +
            metricCard('当前实验新90日收益', pctCell(metric(exp.new_90d_return, '暂无数据', { dp: 4 }))) +
            '</div>' +
            '<div class="card"><div class="card-body"><div class="chart-container" style="height:460px;"><canvas id="equityChart"></canvas></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-body"><div class="chart-container" style="height:280px;"><canvas id="drawdownChart"></canvas></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">四组实验净值对比（绝对权益）</span></div>' +
            '<div class="card-body"><div class="chart-container" style="height:360px;"><canvas id="compareChart"></canvas></div></div></div>';

        setupNavFilters(exp);
        drawEquityChart(exp, '2024-09-02', '2026-07-29');
        drawDrawdownChart(exp, '2024-09-02', '2026-07-29');
        drawCompareChart(contract(), '2024-09-02', '2026-07-29');
    }

    function setupNavFilters(exp) {
        const periodSel = document.getElementById('navPeriod');
        const customFrom = document.getElementById('customDateFrom');
        const customTo = document.getElementById('customDateTo');
        const dateFrom = document.getElementById('navDateFrom');
        const dateTo = document.getElementById('navDateTo');
        const seriesSel = document.getElementById('navSeries');
        const resetBtn = document.getElementById('resetZoomBtn');

        const apply = function (from, to) {
            drawEquityChart(exp, from, to);
            drawDrawdownChart(exp, from, to);
            drawCompareChart(contract(), from, to);
        };

        periodSel.addEventListener('change', function () {
            const val = periodSel.value;
            const isCustom = val === 'custom';
            customFrom.style.display = isCustom ? 'block' : 'none';
            customTo.style.display = isCustom ? 'block' : 'none';
            if (val === 'full') apply('2024-09-02', '2026-07-29');
            else if (val === 'old280') apply('2024-09-02', '2025-10-31');
            else if (val === 'old370') apply('2024-09-02', '2026-03-18');
            else if (val === 'new90') apply('2026-03-19', '2026-07-29');
        });

        dateFrom.addEventListener('change', function () {
            if (dateFrom.value && dateTo.value) apply(dateFrom.value, dateTo.value);
        });
        dateTo.addEventListener('change', function () {
            if (dateFrom.value && dateTo.value) apply(dateFrom.value, dateTo.value);
        });

        seriesSel.addEventListener('change', function () {
            const series = seriesSel.value;
            if (charts.equity) {
                charts.equity.data.datasets.forEach(function (ds, i) {
                    const show = series === 'all' ||
                        (series === 'equity' && !ds.label.includes('回撤')) ||
                        (series === 'drawdown' && ds.label.includes('回撤'));
                    charts.equity.setDatasetVisibility(i, show);
                });
                charts.equity.update();
            }
            if (charts.drawdown) {
                const showDD = series !== 'equity';
                charts.drawdown.canvas.style.display = showDD ? 'block' : 'none';
            }
        });

        resetBtn.addEventListener('click', function () {
            Object.keys(charts).forEach(function (k) {
                if (charts[k] && typeof charts[k].resetZoom === 'function') charts[k].resetZoom();
            });
        });

        dateFrom.value = '2024-09-02';
        dateTo.value = '2026-07-29';
    }

    function filterByRange(points, from, to) {
        return points.filter(function (p) {
            return (!from || p.date >= from) && (!to || p.date <= to);
        });
    }

    function chartReady(canvasId) {
        if (typeof Chart === 'undefined') return null;
        const el = document.getElementById(canvasId);
        if (!el) return null;
        return el.getContext('2d');
    }

    function drawEquityChart(exp, from, to) {
        const ctx = chartReady('equityChart');
        if (!ctx) return;
        const curve = exp.segment_by_key ? null : null;
        const raw = (state.data.equity_curves || {})[exp.curve_key] || [];
        const points = filterByRange(raw, from, to);
        const idx = filterByRange(state.data.index_data || [], from, to);
        const openEquity = points.length ? points[0].total_equity : null;
        const idxNorm = (idx.length && fmt.isNum(openEquity) && idx[0].close > 0)
            ? idx.map(function (p) { return { date: p.date, value: openEquity * (p.close / idx[0].close) }; })
            : [];
        if (charts.equity) charts.equity.destroy();
        charts.equity = new Chart(ctx, {
            type: 'line',
            data: {
                labels: points.map(function (p) { return p.date; }),
                datasets: [
                    {
                        label: exp.label + ' 净值',
                        data: points.map(function (p) { return p.total_equity; }),
                        borderColor: exp.implementation === 'fixed' ? '#e64980' : '#2c7be5',
                        backgroundColor: 'rgba(44,123,229,0.08)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: '沪深300 归一化（起点对齐本区间初始权益）',
                        data: idxNorm.map(function (p) { return p.value; }),
                        borderColor: '#6c757d',
                        backgroundColor: 'rgba(108,117,125,0.08)',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function (c2) {
                                return (c2.dataset.label || '') + ': ' + fmt.money(c2.raw, 2);
                            }
                        }
                    }
                },
                scales: {
                    x: { type: 'category', ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 }, title: { display: true, text: '日期' } },
                    y: { title: { display: true, text: '总权益 (元)' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } }
                }
            }
        });
    }

    function drawDrawdownChart(exp, from, to) {
        const ctx = chartReady('drawdownChart');
        if (!ctx) return;
        const raw = (state.data.equity_curves || {})[exp.curve_key] || [];
        let peak = null;
        const ddPoints = raw.map(function (p) {
            if (peak === null || p.total_equity > peak) peak = p.total_equity;
            return { date: p.date, drawdown: peak > 0 ? p.total_equity / peak - 1 : 0 };
        });
        const points = filterByRange(ddPoints, from, to);
        if (charts.drawdown) charts.drawdown.destroy();
        charts.drawdown = new Chart(ctx, {
            type: 'line',
            data: {
                labels: points.map(function (p) { return p.date; }),
                datasets: [{
                    label: exp.label + ' 回撤',
                    data: points.map(function (p) { return p.drawdown * 100; }),
                    borderColor: exp.implementation === 'fixed' ? '#e64980' : '#2c7be5',
                    backgroundColor: 'rgba(230,73,128,0.12)',
                    borderWidth: 1.5,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + ': ' + Number(c2.raw).toFixed(2) + '%'; } } }
                },
                scales: {
                    x: { type: 'category', ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } },
                    y: { title: { display: true, text: '回撤 (%)' }, ticks: { callback: function (v) { return v + '%'; } } }
                }
            }
        });
    }

    function drawCompareChart(contractObj, from, to) {
        const ctx = chartReady('compareChart');
        if (!ctx) return;
        const curves = state.data.equity_curves || {};
        const palette = {
            original_C_baseline: '#2c7be5',
            original_R_baseline: '#5b8def',
            fixed_C_baseline: '#e64980',
            fixed_R_baseline: '#f08cae'
        };
        const datasets = contractObj.experiments.map(function (e) {
            const pts = filterByRange(curves[e.curve_key] || [], from, to);
            return {
                label: e.label,
                data: pts.map(function (p) { return p.total_equity; }),
                borderColor: palette[e.id],
                backgroundColor: 'rgba(0,0,0,0)',
                borderWidth: e.id === state.experimentId ? 2.6 : 1.4,
                fill: false,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 4
            };
        });
        const labels = filterByRange(curves[contractObj.experiments[0].curve_key] || [], from, to)
            .map(function (p) { return p.date; });
        if (charts.compare) charts.compare.destroy();
        charts.compare = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { callbacks: { label: function (c2) { return (c2.dataset.label || '') + ': ' + fmt.money(c2.raw, 2); } } }
                },
                scales: {
                    x: { type: 'category', ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } },
                    y: { title: { display: true, text: '总权益 (元)' }, ticks: { callback: function (v) { return fmt.money(v, 0); } } }
                }
            }
        });
    }

    function renderComparison(container) {
        const c = contract();
        const exp = currentExperiment();
        const header = '<thead><tr><th>实验</th><th>实现版本</th><th>实验组</th><th>初始资金</th>' +
            '<th>2026-03-18 权益</th><th>2026-07-29 权益</th><th>总收益</th><th>新90日收益</th>' +
            '<th>新90日基准</th><th>新90日超额</th><th>最大回撤</th><th>交易笔数</th><th>风险三层卖出</th><th>首笔风险成交</th></tr></thead>';
        const rows = c.experiments.map(function (e) {
            return '<tr' + (e.id === exp.id ? ' class="active-row"' : '') + '>' +
                '<td><strong>' + esc(e.label) + '</strong><div class="sub mono">' + esc(e.id) + '</div></td>' +
                '<td>' + esc(e.implementation) + '</td>' +
                '<td>' + esc(e.group) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.initial_equity) ? fmt.money(e.initial_equity, 2) : naInline('缺初始资金')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_03_18) ? fmt.money(e.equity_2026_03_18, 6) : naInline('缺 2026-03-18 权益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_07_29) ? fmt.money(e.equity_2026_07_29, 6) : naInline('缺期末权益')) + '</td>' +
                '<td class="mono ' + signClass(e.total_return) + '">' + (fmt.isNum(e.total_return) ? fmt.pct(e.total_return, 2) : naInline('缺总收益')) + '</td>' +
                '<td class="mono ' + signClass(e.new_90d_return) + '">' + (fmt.isNum(e.new_90d_return) ? fmt.pct(e.new_90d_return, 4) : naInline('缺新90日收益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.benchmark_new_90d) ? fmt.pct(e.benchmark_new_90d, 6) : naInline('缺基准')) + '</td>' +
                '<td class="mono ' + signClass(e.new_90d_excess) + '">' + (fmt.isNum(e.new_90d_excess) ? fmt.pct(e.new_90d_excess, 4) : naInline('缺超额')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.max_drawdown) ? fmt.pct(e.max_drawdown, 2) : naInline('缺净值曲线')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.trade_count) ? e.trade_count : naInline('缺交易明细')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.risk_three_layer_sells) ? e.risk_three_layer_sells : naInline('缺卖出原因')) + '</td>' +
                '<td>' + firstRiskText(e) + '</td>' +
                '</tr>';
        }).join('');

        const deltaRows = ['C', 'R'].map(function (g) {
            const o = c.by_id['original_' + g + '_baseline'];
            const f = c.by_id['fixed_' + g + '_baseline'];
            const dEquity = (fmt.isNum(f.equity_2026_07_29) && fmt.isNum(o.equity_2026_07_29))
                ? f.equity_2026_07_29 - o.equity_2026_07_29 : null;
            const dReturn = (fmt.isNum(f.total_return) && fmt.isNum(o.total_return))
                ? f.total_return - o.total_return : null;
            const dRisk = (fmt.isNum(f.risk_three_layer_sells) && fmt.isNum(o.risk_three_layer_sells))
                ? f.risk_three_layer_sells - o.risk_three_layer_sells : null;
            return '<tr><td>' + g + '</td><td class="mono">' + (fmt.isNum(dEquity) ? fmt.money(dEquity, 6) : naInline('缺期末权益')) + '</td>' +
                '<td class="mono ' + signClass(dReturn) + '">' + (fmt.isNum(dReturn) ? fmt.pct(dReturn, 2) : naInline('缺总收益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(dRisk) ? dRisk : naInline('缺卖出原因')) + '</td></tr>';
        }).join('');

        container.innerHTML = sectionHeader('实验比较 · Original/Fixed × C/R', '四组使用同一数据契约，同屏核对金额') +
            '<div class="alert alert-info"><strong>说明：</strong> Original 与 Fixed 的唯一差异是 sector_gate 状态映射（weakening → sector_weak=True）；C/R 唯一主动差异是候选排序。不得把收益较高的一组直接称为“更优策略”。</div>' +
            '<div class="table-container"><table class="matrix-table">' + header + '<tbody>' + rows + '</tbody></table></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">Fixed − Original 差异（同组内）</span></div>' +
            '<div class="card-body"><div class="table-container"><table><thead><tr><th>组</th><th>2026-07-29 权益差</th><th>总收益差</th><th>风险三层卖出差</th></tr></thead><tbody>' +
            deltaRows + '</tbody></table></div>' +
            '<p class="sub" style="margin-top:10px;">首笔风险成交：C 组 ' + esc(firstSymbol(c.by_id.fixed_C_baseline)) + '，R 组 ' + esc(firstSymbol(c.by_id.fixed_R_baseline)) +
            '；signal_date 与 fill_date 见上表。差异是路径结果，不构成策略优劣结论。</p></div></div>' +
            '<div class="alert alert-warning" style="margin-top:16px;">所有金额均来自已验收数据文件，页面不硬编码数值；缺失字段显示“暂无数据”。</div>';
    }

    function firstSymbol(exp) {
        if (!exp) return '暂无数据';
        if (!exp.availability.trades) return '暂无数据';
        if (!exp.first_risk_trade) return '无 risk_three_layer 卖出';
        return exp.first_risk_trade.symbol + '（signal ' + (exp.first_risk_trade.signal_date || '-') + ' / fill ' + (exp.first_risk_trade.fill_date || '-') + '）';
    }

    function signClass(v) {
        if (!fmt.isNum(v)) return '';
        return v > 0 ? 'positive' : (v < 0 ? 'negative' : '');
    }

    function renderSegments(container) {
        const c = contract();
        const exp = currentExperiment();
        const matrixHeader = '<thead><tr><th>实验</th><th>2026-03-18 权益</th><th>2026-07-29 权益</th>' +
            '<th>新90日初始权益</th><th>新90日期末权益</th><th>新90日收益</th><th>新90日基准</th><th>新90日超额</th><th>最大回撤（全区间）</th></tr></thead>';
        const matrixRows = c.experiments.map(function (e) {
            const nw = e.segment_by_key.new_window;
            return '<tr' + (e.id === exp.id ? ' class="active-row"' : '') + '>' +
                '<td><strong>' + esc(e.label) + '</strong><div class="sub mono">' + esc(e.id) + '</div></td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_03_18) ? fmt.money(e.equity_2026_03_18, 6) : naInline('缺 2026-03-18 权益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.equity_2026_07_29) ? fmt.money(e.equity_2026_07_29, 6) : naInline('缺期末权益')) + '</td>' +
                '<td class="mono">' + (nw && fmt.isNum(nw.opening_equity) ? fmt.money(nw.opening_equity, 6) : naInline('缺新90日分段')) + '</td>' +
                '<td class="mono">' + (nw && fmt.isNum(nw.end_equity) ? fmt.money(nw.end_equity, 6) : naInline('缺新90日分段')) + '</td>' +
                '<td class="mono ' + signClass(nw && nw.return) + '">' + (nw && fmt.isNum(nw.return) ? fmt.pct(nw.return, 4) : naInline('缺新90日分段')) + '</td>' +
                '<td class="mono">' + (nw && fmt.isNum(nw.benchmark_return) ? fmt.pct(nw.benchmark_return, 6) : naInline('缺基准')) + '</td>' +
                '<td class="mono ' + signClass(nw && nw.excess_return) + '">' + (nw && fmt.isNum(nw.excess_return) ? fmt.pct(nw.excess_return, 4) : naInline('缺超额')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.max_drawdown) ? fmt.pct(e.max_drawdown, 2) : naInline('缺净值曲线')) + '</td>' +
                '</tr>';
        }).join('');

        const segHeader = '<thead><tr><th>阶段</th><th>起止</th><th>交易日</th><th>初始权益</th><th>期末权益</th>' +
            '<th>阶段收益</th><th>基准收益</th><th>超额收益</th><th>最大回撤</th><th>买卖次数</th><th>来源</th></tr></thead>';
        const segRows = exp.segments.map(function (s) {
            if (!s.available) {
                return '<tr><td>' + esc(s.label) + '</td><td class="mono">' + esc(s.start) + ' ~ ' + esc(s.end) + '</td>' +
                    '<td colspan="9">' + naCell(s.reason) + '</td></tr>';
            }
            return '<tr><td><strong>' + esc(s.label) + '</strong></td>' +
                '<td class="mono">' + esc(s.start) + ' ~ ' + esc(s.end) + '</td>' +
                '<td class="mono">' + s.days + '</td>' +
                '<td class="mono">' + fmt.money(s.opening_equity, 6) + '</td>' +
                '<td class="mono">' + fmt.money(s.end_equity, 6) + '</td>' +
                '<td class="mono ' + signClass(s.return) + '">' + fmt.pct(s.return, 4) + '</td>' +
                '<td class="mono">' + (fmt.isNum(s.benchmark_return) ? fmt.pct(s.benchmark_return, 6) : naInline('缺基准数据')) + '</td>' +
                '<td class="mono ' + signClass(s.excess_return) + '">' + (fmt.isNum(s.excess_return) ? fmt.pct(s.excess_return, 4) : naInline('缺基准数据')) + '</td>' +
                '<td class="mono">' + fmt.pct(s.max_drawdown, 2) + '</td>' +
                '<td class="mono">' + s.buys + ' / ' + s.sells + '</td>' +
                '<td class="sub">' + esc(s.source) + '</td></tr>';
        }).join('');

        container.innerHTML = sectionHeader('分段表现 · ' + exp.label, '分段由该实验自身净值曲线推导，不借用其他组数据') +
            experimentBanner(exp) +
            '<div class="card"><div class="card-header"><span class="card-title">四组关键分段边界</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table">' + matrixHeader + '<tbody>' + matrixRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">' + esc(exp.label) + ' · 分段明细</span>' +
            '<span class="card-sub">连续净值，不在阶段边界重置资金</span></div><div class="card-body">' +
            '<div class="table-container"><table>' + segHeader + '<tbody>' + segRows + '</tbody></table></div>' +
            '<p class="sub" style="margin-top:10px;">新90日收益分母为该组 2026-03-18 权益；基准为沪深300同期（2026-03-18 收盘 → 2026-07-29 收盘）。</p></div></div>' +
            '<div class="alert alert-info" style="margin-top:16px;">缺失分段显示“暂无数据”及原因；真实 0 笔交易显示为 0。</div>';
    }

    let tradesRows = [];

    function buildPnLLookup() {
        const sellPnl = state.data.sell_pnl || {};
        const lookup = {};
        Object.keys(sellPnl).forEach(function (key) {
            const arr = sellPnl[key];
            if (!Array.isArray(arr)) return;
            arr.forEach(function (p) {
                const k = p.group + '|' + p.variant + '|' + p.symbol + '|' + (p.sell_date || p.fill_date) + '|sell';
                lookup[k] = {
                    net_pnl: p.net_pnl,
                    net_return_rate: p.net_return_rate,
                    holding_days: p.holding_days,
                    cumulative_realized_pnl: p.cumulative_realized_pnl,
                    status: p.status,
                    unknown_fields: p.unknown_fields || [],
                    trade_id: p.trade_id || null
                };
            });
        });
        return lookup;
    }

    function flattenTrades() {
        const c = contract();
        const raw = state.data.trades || {};
        const pnlLookup = buildPnLLookup();
        const out = [];
        c.experiments.forEach(function (e) {
            (raw[e.group] || []).forEach(function (t) {
                if ((t.variant || 'original') !== e.implementation) return;
                const isSell = t.side === 'sell';
                const fillDate = t.fill_date || t.trade_date || '';
                let pnlData = null;
                if (isSell) {
                    const key = e.group + '|' + e.implementation + '|' + t.symbol + '|' + fillDate + '|sell';
                    pnlData = pnlLookup[key] || null;
                }
                out.push(Object.assign({}, t, {
                    experiment_id: e.id,
                    experiment_label: e.label,
                    implementation: e.implementation,
                    group: e.group,
                    net_pnl: pnlData ? pnlData.net_pnl : null,
                    net_return_rate: pnlData ? pnlData.net_return_rate : null,
                    holding_days: pnlData ? pnlData.holding_days : null,
                    cumulative_realized_pnl: pnlData ? pnlData.cumulative_realized_pnl : null,
                    unknown_fields: pnlData ? pnlData.unknown_fields : [],
                    trade_id: pnlData ? pnlData.trade_id : (t.trade_id || null)
                }));
            });
        });
        return out;
    }

    function renderTrades(container) {
        const c = contract();
        const exp = currentExperiment();
        tradesRows = flattenTrades().sort(function (a, b) {
            const da = a.fill_date || a.trade_date || '';
            const db = b.fill_date || b.trade_date || '';
            return db.localeCompare(da);
        });
        const options = c.experiments.map(function (e) {
            return '<option value="' + esc(e.id) + '">' + esc(e.label) + '（' + esc(e.implementation) + ' ' + esc(e.group) + '）</option>';
        }).join('');

        container.innerHTML = sectionHeader('交易浏览器 · ' + exp.label, '共 ' + tradesRows.length + ' 笔交易，可按实验切换') +
            experimentBanner(exp) +
            '<div class="alert alert-warning"><strong>标注：</strong> 价格为 <code>adjusted_virtual</code> 空间；数量为 100 股整手近似；不等于真实证券账户成交记录。</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">首笔风险成交（Fixed 组）</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>实验</th><th>代码</th><th>方向</th><th>signal_date</th><th>fill_date</th><th>价格</th><th>数量</th></tr></thead><tbody>' +
            ['fixed_C_baseline', 'fixed_R_baseline'].map(function (id) {
                const e = c.by_id[id];
                const t = e.first_risk_trade;
                if (!e.availability.trades) {
                    return '<tr><td>' + esc(e.label) + '</td><td colspan="6">' + naCell('缺少交易明细') + '</td></tr>';
                }
                if (!t) {
                    return '<tr><td>' + esc(e.label) + '</td><td colspan="6">' + absentZero('无 risk_three_layer 卖出') + '</td></tr>';
                }
                return '<tr><td>' + esc(e.label) + '</td><td class="mono">' + esc(t.symbol) + '</td><td>' + esc(t.side) + '</td>' +
                    '<td class="mono">' + esc(t.signal_date || '-') + '</td><td class="mono">' + esc(t.fill_date || t.trade_date || '-') + '</td>' +
                    '<td class="mono">' + fmt.money(t.price, 4) + '</td><td class="mono">' + fmt.money(t.quantity, 0) + '</td></tr>';
            }).join('') + '</tbody></table></div></div></div>' +
            '<div class="filter-bar" id="tradesFilters">' +
            '<div class="filter-group"><label>实验</label><select id="filterExperiment">' +
            '<option value="">全部四组</option>' + options + '</select></div>' +
            '<div class="filter-group"><label>买卖方向</label><select id="filterSide">' +
            '<option value="">全部</option><option value="buy">买入</option><option value="sell">卖出</option></select></div>' +
            '<div class="filter-group"><label>卖出原因</label><select id="filterReason">' +
            '<option value="">全部</option><option value="target_profit">Target Profit</option><option value="risk_three_layer">Risk Three Layer</option></select></div>' +
            '<div class="filter-group"><label>盈亏筛选</label><select id="filterPnL">' +
            '<option value="">全部</option><option value="profit">盈利</option><option value="loss">亏损</option></select></div>' +
            '<div class="filter-group"><label>起始日期</label><input type="date" id="filterDateFrom"></div>' +
            '<div class="filter-group"><label>结束日期</label><input type="date" id="filterDateTo"></div>' +
            '<div class="filter-group"><label>股票代码</label><input type="text" id="filterSymbol" placeholder="如 300987.SZ"></div>' +
            '<button class="btn btn-secondary btn-sm" id="clearFiltersBtn">清空筛选</button></div>' +
            '<div class="table-container"><table id="tradesTable"><thead><tr>' +
            '<th data-sort="experiment_label">实验</th><th data-sort="group">组</th><th data-sort="symbol">股票代码</th>' +
            '<th data-sort="side">方向</th><th data-sort="signal_date">信号日期</th><th data-sort="fill_date">成交日期</th>' +
            '<th data-sort="price">成交价格</th><th data-sort="quantity">数量</th><th data-sort="amount">成交金额</th>' +
            '<th data-sort="commission">佣金</th><th data-sort="tax">印花税</th><th data-sort="reason">原因</th>' +
            '<th data-sort="net_pnl">本次净盈亏(元)</th><th data-sort="net_return_rate">净收益率</th>' +
            '<th data-sort="holding_days">持有交易日</th><th data-sort="cumulative_realized_pnl">累计已实现净盈亏</th>' +
            '</tr></thead><tbody id="tradesTbody"></tbody></table></div>' +
            '<div class="pagination"><div class="pagination-info" id="tradesInfo">共 0 条</div>' +
            '<div class="pagination-controls"><button class="pagination-btn" id="tradesPrev" disabled>上一页</button>' +
            '<span id="tradesPageInfo">第 1 / 1 页</span>' +
            '<button class="pagination-btn" id="tradesNext" disabled>下一页</button></div></div>';

        state.filters.trades.experiment = exp.id;
        setupTradesFilters();
        renderTradesTable();
    }

    function setupTradesFilters() {
        const map = {
            filterExperiment: 'experiment',
            filterSide: 'side',
            filterReason: 'reason',
            filterPnL: 'pnl',
            filterDateFrom: 'dateFrom',
            filterDateTo: 'dateTo',
            filterSymbol: 'symbol'
        };
        Object.keys(map).forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = state.filters.trades[map[id]] || '';
            const handler = utilsDebouncedApply();
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        });
        document.getElementById('clearFiltersBtn').addEventListener('click', function () {
            state.filters.trades = { experiment: '', side: '', reason: '', pnl: '', dateFrom: '', dateTo: '', symbol: '' };
            Object.keys(map).forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            state.pagination.trades.page = 1;
            renderTradesTable();
        });
        document.querySelectorAll('#tradesTable th[data-sort]').forEach(function (th) {
            th.style.cursor = 'pointer';
            th.addEventListener('click', function () {
                const col = th.dataset.sort;
                if (state.sort.trades.column === col) {
                    state.sort.trades.direction = state.sort.trades.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sort.trades.column = col;
                    state.sort.trades.direction = 'desc';
                }
                renderTradesTable();
            });
        });
        document.getElementById('tradesPrev').addEventListener('click', function () {
            if (state.pagination.trades.page > 1) {
                state.pagination.trades.page--;
                renderTradesTable();
            }
        });
        document.getElementById('tradesNext').addEventListener('click', function () {
            const totalPages = Math.ceil(getFilteredTrades().length / state.pagination.trades.pageSize);
            if (state.pagination.trades.page < totalPages) {
                state.pagination.trades.page++;
                renderTradesTable();
            }
        });
    }

    function utilsDebouncedApply() {
        return debounce(function () {
            state.filters.trades.experiment = document.getElementById('filterExperiment').value;
            state.filters.trades.side = document.getElementById('filterSide').value;
            state.filters.trades.reason = document.getElementById('filterReason').value;
            state.filters.trades.pnl = document.getElementById('filterPnL').value;
            state.filters.trades.dateFrom = document.getElementById('filterDateFrom').value;
            state.filters.trades.dateTo = document.getElementById('filterDateTo').value;
            state.filters.trades.symbol = document.getElementById('filterSymbol').value.trim().toUpperCase();
            state.pagination.trades.page = 1;
            renderTradesTable();
        }, 150);
    }

    function getFilteredTrades() {
        const f = state.filters.trades;
        return tradesRows.filter(function (t) {
            if (f.experiment && t.experiment_id !== f.experiment) return false;
            if (f.side && t.side !== f.side) return false;
            if (f.reason && t.reason !== f.reason) return false;
            if (f.pnl && t.side === 'sell') {
                if (f.pnl === 'profit' && (t.net_pnl === null || t.net_pnl <= 0)) return false;
                if (f.pnl === 'loss' && (t.net_pnl === null || t.net_pnl >= 0)) return false;
            }
            const d = t.fill_date || t.trade_date || '';
            if (f.dateFrom && d < f.dateFrom) return false;
            if (f.dateTo && d > f.dateTo) return false;
            if (f.symbol && !String(t.symbol).toUpperCase().includes(f.symbol)) return false;
            return true;
        });
    }

    function renderTradesTable() {
        const filtered = getFilteredTrades();
        // Apply sorting
        const sortCol = state.sort.trades.column;
        const sortDir = state.sort.trades.direction;
        if (sortCol) {
            filtered.sort(function (a, b) {
                let va = a[sortCol];
                let vb = b[sortCol];
                // Handle null/undefined values
                if (va === null || va === undefined) va = sortDir === 'asc' ? Infinity : -Infinity;
                if (vb === null || vb === undefined) vb = sortDir === 'asc' ? Infinity : -Infinity;
                // String comparison for non-numeric columns
                if (typeof va === 'string' && typeof vb === 'string') {
                    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                }
                // Numeric comparison
                if (va < vb) return sortDir === 'asc' ? -1 : 1;
                if (va > vb) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        const pageSize = state.pagination.trades.pageSize;
        let page = state.pagination.trades.page;
        const totalPages = Math.ceil(filtered.length / pageSize) || 1;
        if (page > totalPages) page = totalPages;
        state.pagination.trades.page = page;
        const start = (page - 1) * pageSize;
        const rows = filtered.slice(start, start + pageSize).map(function (t) {
            const amount = (fmt.isNum(t.price) && fmt.isNum(t.quantity)) ? t.price * t.quantity : null;
            const isSell = t.side === 'sell';
            const pnlCell = function (val, reason, dp, isPct) {
                if (val === null || val === undefined || !fmt.isNum(val)) {
                    if (isSell && reason) return naCell(reason);
                    return absentZero('不适用');  // Buy trades show N/A
                }
                if (isPct) {
                    const cls = val > 0 ? 'positive' : (val < 0 ? 'negative' : '');
                    return '<span class="mono ' + cls + '">' + fmt.pct(val, dp === undefined ? 4 : dp) + '</span>';
                }
                const cls = val > 0 ? 'positive' : (val < 0 ? 'negative' : '');
                return '<span class="mono ' + cls + '">' + fmt.money(val, dp === undefined ? 2 : dp) + '</span>';
            };
            const netPnl = t.net_pnl;
            const netReturn = t.net_return_rate;
            const holding = t.holding_days;
            const cumPnl = t.cumulative_realized_pnl;
            return '<tr>' +
                '<td>' + esc(t.experiment_label) + '</td>' +
                '<td><span class="badge ' + (t.group === 'C' ? 'badge-info' : 'badge-warning') + '">' + esc(t.group) + '</span></td>' +
                '<td class="mono">' + esc(t.symbol) + '</td>' +
                '<td><span class="badge ' + (t.side === 'buy' ? 'badge-success' : 'badge-danger') + '">' + (t.side === 'buy' ? '买入' : '卖出') + '</span></td>' +
                '<td class="mono">' + esc(t.signal_date || '-') + '</td>' +
                '<td class="mono">' + esc(t.fill_date || t.trade_date || '-') + '</td>' +
                '<td class="mono">' + (fmt.isNum(t.price) ? fmt.money(t.price, 4) : naInline('缺价格')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(t.quantity) ? fmt.money(t.quantity, 0) : naInline('缺数量')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(amount) ? fmt.money(amount, 2) : naInline('缺价格或数量')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(t.commission) ? fmt.money(t.commission, 2) : naInline('缺佣金字段')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(t.tax) ? fmt.money(t.tax, 2) : naInline('缺印花税字段')) + '</td>' +
                '<td>' + esc(t.reason || '-') + '</td>' +
                '<td>' + pnlCell(netPnl, t.unknown_fields && t.unknown_fields.length ? t.unknown_fields.join(', ') : (isSell ? 'P&L数据缺失' : '不适用')) + '</td>' +
                '<td>' + pnlCell(netReturn, (t.unknown_fields && t.unknown_fields.length ? t.unknown_fields.join(', ') : '分母缺失或为0'), 4, true) + '</td>' +
                '<td class="mono">' + (fmt.isNum(holding) ? holding : (isSell ? (t.unknown_fields && t.unknown_fields.length ? naCell(t.unknown_fields.join(', ')) : naInline('缺持有期')) : absentZero('不适用'))) + '</td>' +
                '<td>' + pnlCell(cumPnl, isSell ? null : '不适用') + '</td>' +
                '</tr>';
        }).join('');
        const tbody = document.getElementById('tradesTbody');
        if (tbody) tbody.innerHTML = rows || '<tr><td colspan="16" class="sub">当前筛选无交易记录</td></tr>';
        const info = document.getElementById('tradesInfo');
        if (info) info.textContent = '共 ' + filtered.length + ' 条 / 全部 ' + tradesRows.length + ' 条';
        const pageInfo = document.getElementById('tradesPageInfo');
        if (pageInfo) pageInfo.textContent = '第 ' + page + ' / ' + totalPages + ' 页';
        const prev = document.getElementById('tradesPrev');
        const next = document.getElementById('tradesNext');
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= totalPages;
    }

    function renderRiskFix(container) {
        const c = contract();
        const exp = currentExperiment();
        const risk = state.data.risk_events || {};
        const meta = (c.by_id.fixed_C_baseline || {}).risk_fix_metadata || {};
        const history = state.data.version_history || [];
        const v3 = history.find(function (v) { return v.version && v.version.indexOf('RiskFixV1') === 0; }) || {};
        const groupRows = ['C', 'R'].map(function (g) {
            const o = c.by_id['original_' + g + '_baseline'];
            const f = c.by_id['fixed_' + g + '_baseline'];
            const dEquity = (fmt.isNum(o.equity_2026_07_29) && fmt.isNum(f.equity_2026_07_29))
                ? f.equity_2026_07_29 - o.equity_2026_07_29 : null;
            return '<tr><td><strong>Group ' + g + '</strong></td>' +
                '<td class="mono">' + fmt.money(o.equity_2026_07_29, 6) + '</td>' +
                '<td class="mono">' + fmt.money(f.equity_2026_07_29, 6) + '</td>' +
                '<td class="mono ' + signClass(dEquity) + '">' + (fmt.isNum(dEquity) ? (dEquity > 0 ? '+' : '') + fmt.money(dEquity, 6) : naInline('缺期末权益')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(o.risk_three_layer_sells) ? o.risk_three_layer_sells : naInline('缺卖出原因')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(f.risk_three_layer_sells) ? f.risk_three_layer_sells : naInline('缺卖出原因')) + '</td>' +
                '<td>' + firstRiskText(f) + '</td></tr>';
        }).join('');

        container.innerHTML = sectionHeader('风险修复实验 · Original vs Fixed', 'sector_gate weakening 状态映射修复对照') +
            experimentBanner(exp) +
            '<div class="alert alert-info"><strong>修复缺陷：</strong> <code>' + esc(meta.defect_fixed || 'sector_gate weakness mapping') + '</code>。' +
            'Original 组 sector_gate 的 <code>weakening</code> 状态未映射为 <code>sector_weak=True</code>，导致三层风险卖出路径不可达；Fixed 组已修复映射。</div>' +
            '<div class="metric-grid compact">' +
            metricCard('Original 标签', '<span class="text-wrap">' + esc(meta.original_label || '含已确认风险状态缺陷的历史对照') + '</span>') +
            metricCard('Fixed 标签', '<span class="text-wrap">' + esc(meta.fixed_label || '状态映射已修复，策略表达待审阅') + '</span>') +
            metricCard('待用户决策项', countCell(metric(meta.pending_user_decisions, '缺少决策项计数'))) +
            metricCard('允许的卖出原因', '<span class="text-wrap mono">' + esc((risk.allowed_reasons || []).join(' / ') || '暂无数据') + '</span>') +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">四组修复对照（严格同组比较）</span></div><div class="card-body">' +
            '<div class="table-container"><table class="matrix-table"><thead><tr><th>组</th><th>Original 2026-07-29 权益</th><th>Fixed 2026-07-29 权益</th>' +
            '<th>权益差（Fixed−Original）</th><th>Original 风险三层卖出</th><th>Fixed 风险三层卖出</th><th>Fixed 首笔风险成交</th></tr></thead><tbody>' +
            groupRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">风险事件计数</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>窗口</th><th>组</th><th>Original target_profit</th><th>Original risk_three_layer</th><th>Fixed target_profit</th><th>Fixed risk_three_layer</th></tr></thead><tbody>' +
            ['baseline_full_period', 'new_window'].map(function (win) {
                return ['C', 'R'].map(function (g) {
                    const w = (risk[win] || {})[g] || {};
                    const o = w.original || {};
                    const f = w.fixed || {};
                    const label = win === 'baseline_full_period' ? '全区间' : '新90日';
                    return '<tr><td>' + label + '</td><td>' + g + '</td>' +
                        '<td class="mono">' + (fmt.isNum(o.target_profit) ? o.target_profit : naInline('缺数据')) + '</td>' +
                        '<td class="mono">' + (fmt.isNum(o.risk_three_layer) ? o.risk_three_layer : naInline('缺数据')) + '</td>' +
                        '<td class="mono">' + (fmt.isNum(f.target_profit) ? f.target_profit : naInline('缺数据')) + '</td>' +
                        '<td class="mono">' + (fmt.isNum(f.risk_three_layer) ? f.risk_three_layer : naInline('缺数据')) + '</td></tr>';
                }).join('');
            }).join('') + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">已接受 / 未接受边界</span></div><div class="card-body">' +
            '<p><strong>Accepted：</strong>' + esc(v3.accepted || '暂无数据') + '</p>' +
            '<p style="margin-top:8px;"><strong>Not accepted：</strong>' + esc(v3.not_accepted || '暂无数据') + '</p>' +
            '<p class="sub" style="margin-top:8px;">' + esc(v3.note || '') + '</p></div></div>' +
            '<div class="alert alert-warning" style="margin-top:16px;">四个策略表达项（持续板块弱势定义、回撤幅度阈值、回撤天数阈值、no_承接 定义）仍待用户决策；本页只展示修复前后对照，不继续扩展数据或修改策略。</div>';
    }

    function renderConcentration(container) {
        const conc = state.data.concentration || {};
        const base = conc.baseline || {};
        const cData = base.C;
        const rData = base.R;
        const rows = [
            ['最大单股权重', 'max_single_position_weight', true],
            ['最大单股权重日期', 'max_single_position_date', false],
            ['Top5 权重', 'max_top5_weight', true],
            ['Top10 权重', 'max_top10_weight', true],
            ['Top3 行业权重', 'max_top3_industry_weight', true],
            ['最大同时持仓', 'max_simultaneous_positions', false],
            ['期末持仓数', 'final_positions', false],
            ['平均持仓数', 'mean_positions', false]
        ].map(function (r) {
            const val = function (d) {
                if (!d) return naInline('缺少原始组集中度数据');
                const v = d[r[1]];
                if (r[2]) return fmt.isNum(v) ? fmt.pct(v, 2) : naInline('缺字段 ' + r[1]);
                return fmt.isNum(v) ? (r[1].indexOf('date') >= 0 ? esc(String(v)) : String(v)) : naInline('缺字段 ' + r[1]);
            };
            return '<tr><td>' + r[0] + '</td><td class="mono">' + val(cData) + '</td><td class="mono">' + val(rData) + '</td></tr>';
        }).join('');

        container.innerHTML = sectionHeader('持仓与集中度', '该切片仅覆盖 Original C/R（baseline），不含 Fixed 组文件') +
            '<div class="alert alert-info">数据来源：<code>concentration.json#baseline</code>（Original C/R）。Fixed 组未生成集中度文件，页面显示“暂无数据”，不借用 Original 数据。</div>' +
            '<div class="table-container"><table><thead><tr><th>指标</th><th>Original C</th><th>Original R</th></tr></thead><tbody>' +
            rows + '</tbody></table></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">Fixed 组可用状态</span></div><div class="card-body">' +
            '<p>Fixed C / Fixed R：' + naCell('数据包未包含 concentration.json 的修复组切片') + '</p>' +
            '<p class="sub" style="margin-top:8px;">如需修复组集中度，需要重新生成该切片的数据文件；本任务不扩展数据。</p></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">会计语义</span></div><div class="card-body">' +
            '<ul style="line-height:2;"><li><strong>价格模式：</strong> adjusted_virtual</li><li><strong>账本性质：</strong> 策略比较账本，非真实证券账户</li>' +
            '<li><strong>整手近似：</strong> 100 股整手（调整价格空间）</li><li><strong>公司行为：</strong> 未完成</li><li><strong>状态：</strong> Provisional</li></ul></div></div>';
    }

    function renderCostAttribution(container) {
        const attr = state.data.cost_attribution || {};
        const sens = state.data.cost_sensitivity || {};
        const cc = contract();
        const fixedC = cc.by_id.fixed_C_baseline;
        const fixedR = cc.by_id.fixed_R_baseline;
        const labels = { double_slippage: '双倍滑点', double_commission: '双倍佣金', double_both: '双倍滑点+佣金' };
        const signed = function (v) { return fmt.isNum(v) ? (v > 0 ? '+' : '') + fmt.money(v, 2) : null; };

        const sensRows = ['baseline', 'double_slippage', 'double_commission', 'double_both'].map(function (k) {
            const s = sens[k] || {};
            const label = k === 'baseline' ? 'baseline（Original）' : labels[k];
            return '<tr><td>' + esc(label) + '</td>' +
                '<td class="mono">' + (fmt.isNum(s.C) ? fmt.money(s.C, 6) : naInline('缺该情景')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(s.R) ? fmt.money(s.R, 6) : naInline('缺该情景')) + '</td></tr>';
        }).join('');

        const block = function (group, scenario) {
            const a = (attr[group] || {})[scenario];
            if (!a) {
                return '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">Original ' + group + ' · ' + labels[scenario] + '</span></div>' +
                    '<div class="card-body">' + naCell('cost_attribution.json 缺少该组合') + '</div></div>';
            }
            const cons = a.conservation || {};
            const fd = a.first_divergence || {};
            const ft = fd.first_trade_difference || {};
            const rows = (a.top_contributors || []).slice(0, 8).map(function (r) {
                return '<tr><td class="mono">' + esc(r.ts_code) + '</td><td>' + (signed(r.delta_net) || '-') + '</td>' +
                    '<td>' + (signed(r.delta_realized) || '-') + '</td><td>' + (signed(r.delta_unrealized) || '-') + '</td>' +
                    '<td>' + (signed(r.delta_fees) || '-') + '</td><td class="mono">' + (fmt.isNum(r.delta_bought_qty) ? r.delta_bought_qty : '-') + '</td>' +
                    '<td><span class="badge badge-neutral">' + esc(r.channel || '') + '</span></td></tr>';
            }).join('');
            return '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">Original ' + group + ' · ' + labels[scenario] + '</span></div><div class="card-body">' +
                '<div class="metric-grid compact">' +
                metricCard('total_effect', signed(a.total_effect) || naInline('缺字段')) +
                metricCard('direct_cost_effect', signed(a.direct_cost_effect) || naInline('缺字段')) +
                metricCard('allocation_path_effect', signed(a.allocation_path_effect) || naInline('缺字段')) +
                metricCard('holding_path_effect', signed(a.holding_path_effect) || naInline('缺字段')) +
                '</div><ul style="line-height:1.9;font-size:0.87rem;margin-top:12px;">' +
                '<li><strong>守恒校验：</strong> 分项合计 ' + (fmt.isNum(cons.sum_components) ? fmt.money(cons.sum_components, 2) : '暂无数据') +
                '，残差 ' + (fmt.isNum(cons.residual) ? cons.residual : '暂无数据') + ' ' + (cons.conserved ? '通过' : '未通过') + '</li>' +
                '<li><strong>费用差 / 滑点差：</strong> ' + (signed(a.fee_delta) || '暂无数据') + ' / ' + (signed(a.slippage_delta) || '暂无数据') + '</li>' +
                '<li><strong>首个成交差异：</strong> ' + (ft.baseline ? esc(String(ft.baseline[1])) + ' ' + esc(String(ft.baseline[2])) + ' ' + esc(String(ft.baseline[0])) : '暂无数据') + '</li>' +
                '</ul><div class="table-container" style="margin-top:12px;"><table><thead><tr><th>标的</th><th>净差</th><th>已实现差</th><th>未实现差</th><th>费用差</th><th>买入股数差</th><th>渠道</th></tr></thead><tbody>' +
                rows + '</tbody></table></div></div></div>';
        };

        container.innerHTML = sectionHeader('成本路径归因', '该切片仅覆盖 Original C/R；Fixed 组未生成该文件') +
            '<div class="alert alert-info">成本提高后期末权益更高只可能来自“成本变化 → 可买数量变化 → 持仓路径变化”的间接路径，不得解释为“高成本更优”。</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">成本敏感性期末权益（baseline 为 Original）</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>情景</th><th>Group C</th><th>Group R</th></tr></thead><tbody>' + sensRows + '</tbody></table></div>' +
            '<p class="sub" style="margin-top:8px;">Fixed C 期末权益 ' +
            (fmt.isNum(fixedC.equity_2026_07_29) ? fmt.money(fixedC.equity_2026_07_29, 6) : '暂无数据') + ' / Fixed R 期末权益 ' +
            (fmt.isNum(fixedR.equity_2026_07_29) ? fmt.money(fixedR.equity_2026_07_29, 6) : '暂无数据') +
            ' 见实验比较页；此处不混用。</p></div></div>' +
            ['C', 'R'].map(function (g) { return Object.keys(labels).map(function (s) { return block(g, s); }).join(''); }).join('');
    }

    function renderBehaviour(container) {
        const freq = state.data.trading_frequency || {};
        const hold = state.data.holding_period || {};
        const risk = state.data.risk_events || {};
        const c = contract();
        const num = function (v) { return fmt.isNum(v) ? fmt.money(v, 2) : null; };
        const cell = function (v, dp) {
            if (!fmt.isNum(v)) return naInline('缺少原始组该字段');
            return dp === undefined ? fmt.money(v, 2) : fmt.pct(v, dp);
        };
        const fRow = function (label, field, isPct) {
            return '<tr><td>' + label + '</td><td class="mono">' + cell((freq.C || {})[field], isPct ? 2 : undefined) + '</td>' +
                '<td class="mono">' + cell((freq.R || {})[field], isPct ? 2 : undefined) + '</td></tr>';
        };
        const hRow = function (label, field) {
            return '<tr><td>' + label + '</td><td class="mono">' + cell((hold.C || {})[field]) + '</td>' +
                '<td class="mono">' + cell((hold.R || {})[field]) + '</td></tr>';
        };
        const fixedTradeRows = ['fixed_C_baseline', 'fixed_R_baseline'].map(function (id) {
            const e = c.by_id[id];
            return '<tr><td>' + esc(e.label) + '</td><td class="mono">' + (fmt.isNum(e.trade_count) ? e.trade_count : naInline('缺交易明细')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.buys) ? e.buys : naInline('缺交易明细')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.sells) ? e.sells : naInline('缺交易明细')) + '</td>' +
                '<td class="mono">' + (fmt.isNum(e.risk_three_layer_sells) ? e.risk_three_layer_sells : naInline('缺卖出原因')) + '</td></tr>';
        }).join('');

        container.innerHTML = sectionHeader('交易频率与持有期', '原始组字段来自数据包；Fixed 组仅交易笔数可统计') +
            '<div class="alert alert-info">频率/持有期数据文件仅覆盖 Original C/R；Fixed 组持有期文件缺失，显示“暂无数据”，不借用 Original。</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">交易频率（Original）</span></div><div class="card-body"><div class="table-container"><table>' +
            '<thead><tr><th>指标</th><th>Group C</th><th>Group R</th></tr></thead><tbody>' +
            fRow('交易笔数', 'trades_total') + fRow('日均交易笔数', 'trades_per_trade_day') +
            fRow('年均交易笔数 (252)', 'trades_per_year_252') + fRow('有交易日占比', 'days_with_trades_share', true) +
            fRow('新增区间交易笔数', 'new_window_trades') + fRow('新增区间日均', 'new_window_trades_per_day') +
            '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">持有期（Original，交易日）</span></div><div class="card-body"><div class="table-container"><table>' +
            '<thead><tr><th>指标</th><th>Group C</th><th>Group R</th></tr></thead><tbody>' +
            hRow('已平仓笔数', 'closed_positions') + hRow('平均持有', 'mean_holding_trading_days') +
            hRow('中位持有', 'median_holding_trading_days') + hRow('P10', 'p10_holding_trading_days') +
            hRow('P90', 'p90_holding_trading_days') + '</tbody></table></div>' +
            '<p class="sub" style="margin-top:8px;">Fixed 组持有期：' + naInline('数据包未包含 holding_period.json 的修复组切片') + '</p></div></div>' +
            '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">Fixed 组交易笔数（由交易明细统计）</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>实验</th><th>交易笔数</th><th>买入</th><th>卖出</th><th>风险三层卖出</th></tr></thead><tbody>' +
            fixedTradeRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:16px;"><div class="card-header"><span class="card-title">风险事件与允许原因</span></div><div class="card-body"><ul style="line-height:1.9;font-size:0.87rem;">' +
            '<li><strong>允许的卖出原因：</strong> ' + esc((risk.allowed_reasons || []).join(' / ') || '暂无数据') + '</li>' +
            '<li><strong>Original 风险三层卖出：</strong> C ' + (fmt.isNum(((risk.risk_three_layer_full_period || {}).C || {}).original) ? risk.risk_three_layer_full_period.C.original : '暂无数据') +
            ' / R ' + (fmt.isNum(((risk.risk_three_layer_full_period || {}).R || {}).original) ? risk.risk_three_layer_full_period.R.original : '暂无数据') + '</li>' +
            '<li><strong>Fixed 风险三层卖出：</strong> C ' + (fmt.isNum(((risk.risk_three_layer_full_period || {}).C || {}).fixed) ? risk.risk_three_layer_full_period.C.fixed : '暂无数据') +
            ' / R ' + (fmt.isNum(((risk.risk_three_layer_full_period || {}).R || {}).fixed) ? risk.risk_three_layer_full_period.R.fixed : '暂无数据') + '</li>' +
            '</ul></div></div>';
    }

    function renderQuality(container) {
        const dq = state.data.data_quality || {};
        const cov = state.data.coverage || {};
        const uni = state.data.universe_info || {};
        const man = state.data.manifest || {};
        const preserved = dq.old_window_preserved_value_for_value || {};
        const preservedOk = Object.keys(preserved).every(function (k) { return preserved[k] && preserved[k].identical; });
        container.innerHTML = sectionHeader('数据质量', '覆盖率、口径说明与已知限制') +
            '<div class="metric-grid">' +
            metricCard('数据日期范围', '<span class="text-wrap mono">' + esc((dq.data_date_range || (cov.date_range ? cov.date_range.start + ' to ' + cov.date_range.end : '暂无数据'))) + '</span>') +
            metricCard('交易日数量', countCell(metric(dq.trade_days !== undefined ? dq.trade_days : cov.trade_days, '缺少交易日字段'))) +
            metricCard('Formal Universe', countCell(metric(dq.formal_universe !== undefined ? dq.formal_universe : uni.formal_universe, '缺少股票池字段'))) +
            metricCard('Raw Universe', countCell(metric(uni.raw_universe, '缺少股票池字段'))) +
            metricCard('Excluded BJ', countCell(metric(uni.excluded_bj, '缺少排除字段'))) +
            metricCard('Daily 覆盖率', fmt.isNum(cov.daily_coverage_pct) ? fmt.money(cov.daily_coverage_pct, 2) + '%' : naInline('缺覆盖率')) +
            metricCard('Adj Factor 覆盖率', fmt.isNum(cov.adj_factor_coverage_pct) ? fmt.money(cov.adj_factor_coverage_pct, 2) + '%' : naInline('缺覆盖率')) +
            metricCard('Index 覆盖率', fmt.isNum(cov.index_coverage_pct) ? fmt.money(cov.index_coverage_pct, 2) + '%' : naInline('缺覆盖率')) +
            '</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">复权与板块口径</span></div><div class="card-body"><ul style="line-height:2;">' +
            '<li><strong>复权口径：</strong> <code>' + esc(dq.adj_factor_source || '暂无数据') + '</code></li>' +
            '<li><strong>旧窗口逐值保留：</strong> ' + (preservedOk ? '是（adjusted_daily / sector_daily / index_daily 哈希一致）' : '见证据') + '</li>' +
            '<li><strong>网络调用：</strong> ' + (fmt.isNum(dq.api_calls) ? dq.api_calls + ' / ' + (dq.api_budget_limit || '?') : '暂无数据') + '</li>' +
            '<li><strong>板块代理口径：</strong> ' + esc(dq.sector_proxy || '暂无数据') + '</li>' +
            '<li><strong>板块基准：</strong> ' + esc(dq.sector_basis || '暂无数据') + '</li>' +
            '<li><strong>数据源：</strong> ' + esc(dq.data_source || '暂无数据') + '</li></ul></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">已知限制（manifest）</span></div><div class="card-body"><ul style="line-height:2;">' +
            ((man.limitations || dq.limitations || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') || '<li>暂无数据</li>') +
            '</ul></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">B 股/北交所排除明细</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>代码</th><th>交易所</th></tr></thead><tbody>' +
            ((uni.bj_codes || []).map(function (s) { return '<tr><td class="mono">' + esc(s) + '</td><td>BJ</td></tr>'; }).join('') || '<tr><td colspan="2">暂无数据</td></tr>') +
            '</tbody></table></div></div></div>';
    }

    function renderV2P2(container) {
        const st = state.data.v2_p2_status;
        const cs = state.data.v2_p2_case;
        if (!st || !cs) {
            container.innerHTML = sectionHeader('V2实施状态', 'P2 状态数据缺失') +
                '<div class="alert alert-warning">缺少 v2_p2_status.json 或 v2_p2_case.json，无法展示 V2 实施状态。</div>';
            return;
        }
        const stateBadge = function (value) {
            const text = String(value || '');
            let cls = 'badge-neutral';
            if (text.indexOf('已集成') >= 0 || text.indexOf('已确认') >= 0 || text.indexOf('已验证') >= 0) cls = 'badge-success';
            else if (text.indexOf('不具备') >= 0 || text.indexOf('不足') >= 0 || text.indexOf('缺失') >= 0 || text.indexOf('待确认') >= 0) cls = 'badge-warning';
            return '<span class="badge ' + cls + '">' + esc(text) + '</span>';
        };
        const statusRows = (st.items || []).map(function (it) {
            return '<tr><td><strong>' + esc(it.label) + '</strong><div class="sub mono">' + esc(it.key) + '</div></td>' +
                '<td>' + stateBadge(it.state) + '</td>' +
                '<td class="text-wrap">' + esc(it.detail) + '</td>' +
                '<td class="text-wrap mono">' + esc(it.evidence || '') + '</td>' +
                '<td class="mono">' + esc((it.rule_ids || []).join(', ')) + '</td></tr>';
        }).join('');
        const blockerRows = ((st.readiness || {}).blockers || []).map(function (b) {
            return '<tr><td class="mono">' + esc(b.code) + '</td><td class="text-wrap">' + esc(b.detail) +
                '</td><td class="text-wrap">' + esc(b.required_for) + '</td></tr>';
        }).join('') || '<tr><td colspan="3">无阻塞项</td></tr>';
        const fin = (st.readiness || {}).financial_coverage || {};
        const orderRows = (cs.orders || []).map(function (o) {
            const fills = (o.fills || []).map(function (f) {
                return esc(f.fill_date) + ' × ' + f.quantity + ' @ ' + fmt.money(f.fill_price, 4);
            }).join('<br>') || '—';
            return '<tr><td class="mono">' + esc(o.order_id) + '</td><td class="mono">' + esc(o.symbol) + '</td>' +
                '<td>' + esc(o.side) + '</td><td>' + esc(o.status) + '</td><td class="mono">' + o.quantity +
                '</td><td class="mono">' + esc(o.signal_date) + '</td><td class="text-wrap">' + fills +
                '</td><td class="text-wrap">' + esc(o.reason) + '</td></tr>';
        }).join('');
        const reviewRows = (cs.reviews || []).map(function (r) {
            const net = fmt.isNum(r.current_net_return) ? fmt.pct(r.current_net_return, 2) : naInline('行情缺失');
            return '<tr><td class="mono">' + esc(r.review_date) + '</td><td class="mono">' + esc(r.symbol) +
                '</td><td class="mono">' + r.holding_trading_days + '</td><td class="text-wrap">' +
                esc((r.triggers || []).join(', ')) + '</td><td>' + esc(r.conclusion) + '</td>' +
                '<td class="mono">' + net + '</td><td>' + esc(r.data_integrity) + '</td>' +
                '<td class="text-wrap">' + esc(r.next_scheduled_review_date || '—') + '</td></tr>';
        }).join('');
        const dailyRows = (cs.daily || []).map(function (d) {
            const checks = d.checks || {};
            const ok = Object.keys(checks).filter(function (k) { return typeof checks[k] === 'boolean'; })
                .every(function (k) { return checks[k]; });
            return '<tr><td class="mono">' + esc(d.trade_date) + '</td><td class="mono">' + fmt.money(d.cash, 2) +
                '</td><td class="mono">' + fmt.money(d.market_value, 2) + '</td><td class="mono">' + fmt.money(d.equity, 2) +
                '</td><td class="mono">' + d.occupied_seats + '</td><td class="text-wrap mono">' +
                esc(Object.keys(d.occupied_symbols || {}).join(', ') || '—') + '</td><td class="mono">' +
                fmt.money(d.fees_cumulative, 2) + '</td><td>' + (ok ? '<span class="ok">通过</span>' : '<span class="miss">失败</span>') + '</td></tr>';
        }).join('');
        const summary = cs.summary || {};
        container.innerHTML = sectionHeader('V2实施状态 · P2',
            '五席位、财务硬门禁、5交易日与事件复核；fixture闭环已集成，正式数据仍受限') +
            '<div class="alert alert-warning"><strong>功能演示：</strong>' + esc(cs.disclaimer || '') +
            ' 本页 fixture 案例不与下方四组历史真实数据实验混算。</div>' +
            '<div class="card"><div class="card-header"><span class="card-title">实施状态</span>' +
            '<span class="card-sub">完成状态 ' + esc(st.completion_status) + '</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>项目</th><th>状态</th><th>说明</th><th>证据</th><th>规则</th></tr></thead><tbody>' +
            statusRows + '</tbody></table></div></div></div>' +
            '<div class="metric-grid" style="margin-top:20px;">' +
            metricCard('真实财务覆盖股票', '<span class="mono">' +
                esc(fmt.isNum(fin.distinct_symbols) ? String(fin.distinct_symbols) : '暂无数据') +
                ' / ' + esc(fmt.isNum(fin.expected_stock_days) ? '预期股票日 ' + fin.expected_stock_days : '预期股票日 暂无数据') +
                '</span>') +
            metricCard('sufficient 股票日覆盖', fmt.isNum(fin.sufficient_stock_day_coverage) ? fmt.pct(fin.sufficient_stock_day_coverage, 4) : naInline('缺字段')) +
            metricCard('正式评分配置', ((st.readiness || {}).scoring || {}).production_scoring_configured ? '已配置' : '<span class="miss">未配置</span>') +
            metricCard('正式收益曲线', (st.readiness || {}).status === 'v2_real_data_ready_for_formal_backtest' ? '具备' : '<span class="miss">不具备</span>') +
            '</div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">真实数据阻塞项</span>' +
            '<span class="card-sub">状态 ' + esc((st.readiness || {}).status) + '</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>代码</th><th>说明</th><th>影响</th></tr></thead><tbody>' +
            blockerRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">fixture 完整案例（功能演示）</span>' +
            '<span class="card-sub">非正式回测，不与历史实验混合</span></div><div class="card-body">' +
            '<div class="metric-grid">' +
            metricCard('fixture 期末权益', fmt.money(summary.final_equity, 2), 'mono') +
            metricCard('fixture 总收益', fmt.pct(summary.total_return, 4)) +
            metricCard('fixture 费用', fmt.money(summary.total_fees, 2), 'mono') +
            metricCard('fixture 已实现净盈亏', fmt.money(summary.total_realized_pnl, 2), 'mono') +
            metricCard('订单数', String(summary.orders === undefined ? '暂无数据' : summary.orders)) +
            metricCard('复核数', String(summary.reviews === undefined ? '暂无数据' : summary.reviews)) +
            metricCard('退出信号', String(summary.exit_signals === undefined ? '暂无数据' : summary.exit_signals)) +
            metricCard('NOT_EVALUABLE 复核', String(summary.not_evaluable_reviews === undefined ? '暂无数据' : summary.not_evaluable_reviews)) +
            '</div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">fixture 订单与成交</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>订单</th><th>股票</th><th>方向</th><th>状态</th><th>数量</th><th>信号日</th><th>成交</th><th>原因</th></tr></thead><tbody>' +
            orderRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">fixture 持有复核</span></div><div class="card-body">' +
            '<div class="table-container" style="max-height:520px;overflow:auto;"><table><thead><tr><th>复核日</th><th>股票</th><th>持有交易日</th><th>触发</th><th>结论</th><th>当前净收益</th><th>数据完整性</th><th>下一定期复核</th></tr></thead><tbody>' +
            reviewRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">fixture 每日席位与资金对账</span></div><div class="card-body">' +
            '<div class="table-container" style="max-height:520px;overflow:auto;"><table><thead><tr><th>日期</th><th>现金</th><th>市值</th><th>权益</th><th>占用席位</th><th>占用股票</th><th>累计费用</th><th>对账</th></tr></thead><tbody>' +
            dailyRows + '</tbody></table></div></div></div>' +
            '<div class="card" style="margin-top:20px;"><div class="card-header"><span class="card-title">fixture 等待候选</span>' +
            '<span class="card-sub">满5只时不卖旧持仓，等待席位并在信号日重新核验</span></div><div class="card-body">' +
            '<div class="table-container"><table><thead><tr><th>候选</th><th>优先级</th><th>等待原因</th><th>提升尝试</th><th>最近拒绝原因</th></tr></thead><tbody>' +
            ((cs.wait_queue || []).map(function (w) {
                const hist = (w.reject_history || []);
                const last = hist.length ? hist[hist.length - 1] : null;
                return '<tr><td class="mono">' + esc(w.symbol) + '</td><td class="mono">' + w.priority +
                    '</td><td class="text-wrap">' + esc(w.queued_reason || '') + '</td><td class="mono">' +
                    w.promotion_attempts + '</td><td class="text-wrap">' +
                    esc(last ? (last.reason + (last.details ? ': ' + (Array.isArray(last.details) ? last.details.join(', ') : last.details) : '')) : '—') +
                    '</td></tr>';
            }).join('') || '<tr><td colspan="5">无等待候选</td></tr>') +
            '</tbody></table></div></div></div>' +
            '<div class="alert alert-info" style="margin-top:16px;"><strong>边界：</strong> 历史V1的两百多只持仓不代表V2；本页四条历史实验仍按各自 Original/Fixed × C/R 口径展示，不被V2 fixture案例改写。</div>';
    }

    function renderHistory(container) {
        const history = state.data.version_history || [];
        container.innerHTML = sectionHeader('版本历史', '从 Pilot 到 RiskFixV1（历史版本保留）') +
            '<div class="card"><div class="card-body"><div style="position:relative;padding-left:24px;">' +
            '<div style="position:absolute;left:11px;top:0;bottom:0;width:2px;background:var(--border-color);"></div>' +
            (history.map(function (v) {
                const color = v.is_formal ? '#2c7be5' : (v.status === 'formal_baseline' ? '#28a745' : (v.status === 'superseded' ? '#dc3545' : '#6c757d'));
                return '<div style="position:relative;padding-bottom:32px;padding-left:16px;">' +
                    '<div style="position:absolute;left:-20px;top:4px;width:14px;height:14px;border-radius:50%;background:' + color + ';border:3px solid var(--bg-primary);z-index:1;"></div>' +
                    '<div style="font-weight:600;"><span class="mono">' + esc(v.version) + '</span> <span class="badge ' +
                    (v.is_formal ? 'badge-info' : (v.status === 'formal_baseline' ? 'badge-success' : (v.status === 'superseded' ? 'badge-danger' : 'badge-neutral'))) + '">' + esc(v.status) + '</span></div>' +
                    '<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">' + esc(v.date) + '</div>' +
                    '<div style="margin-top:8px;font-size:0.85rem;"><div><strong>Accepted:</strong> ' + esc(v.accepted) + '</div>' +
                    '<div><strong>Not Accepted:</strong> ' + esc(v.not_accepted) + '</div>' +
                    (v.superseded_by ? '<div><strong>Superseded by:</strong> ' + esc(v.superseded_by) + '</div>' : '') +
                    (v.note ? '<div style="margin-top:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-secondary);"><strong>注：</strong> ' + esc(v.note) + '</div>' : '') +
                    '</div></div>';
            }).join('') || '<div>暂无数据</div>') +
            '</div></div></div>' +
            '<div class="alert alert-warning" style="margin-top:20px;"><strong>重点说明：</strong> RiskFixV1 只修复 sector_gate 映射缺陷；四个策略表达项仍待用户决策，不代表策略效力已获接受。</div>';
    }

    function renderFeedbackPage(container) {
        container.innerHTML = sectionHeader('修正意见', '记录、追踪并导出实验修正意见（localStorage: ' + FEEDBACK_STORAGE_KEY + '）') +
            '<div class="section-header" style="margin-top:-8px;"><div></div>' +
            '<button class="btn btn-primary" id="newFeedbackBtn">新增意见</button></div>' +
            '<div class="filter-bar"><div class="filter-group"><label>状态筛选</label><select id="feedbackStatusFilter">' +
            '<option value="">全部</option><option value="pending">待讨论</option><option value="accepted">已接受</option>' +
            '<option value="rejected">已拒绝</option><option value="executed">已执行</option></select></div>' +
            '<div class="filter-group"><label>类型筛选</label><select id="feedbackTypeFilter">' +
            '<option value="">全部</option><option value="buy_logic">买入逻辑</option><option value="sell_logic">卖出逻辑</option>' +
            '<option value="observation">观察期</option><option value="sector_judgment">板块判断</option>' +
            '<option value="market_judgment">大盘判断</option><option value="financial_judgment">财务判断</option>' +
            '<option value="candidate_ranking">候选排序</option><option value="capital_allocation">资金分配</option>' +
            '<option value="display">页面展示</option><option value="data_issue">数据问题</option><option value="other">其他</option></select></div>' +
            '<button class="btn btn-secondary btn-sm" id="importFeedbackBtn">导入 JSON</button>' +
            '<input type="file" id="importFeedbackFile" accept=".json" style="display:none;"></div>' +
            '<div class="feedback-list" id="feedbackList"></div>' +
            '<div style="text-align:center;margin-top:24px;color:var(--text-muted);font-size:0.85rem;">意见仅保存在浏览器 localStorage，可导出 JSON；旧版本意见可读取、编辑、导出与导入。</div>';

        document.getElementById('newFeedbackBtn').addEventListener('click', function () { openFeedbackModal(); });
        document.getElementById('feedbackStatusFilter').addEventListener('change', renderFeedbackList);
        document.getElementById('feedbackTypeFilter').addEventListener('change', renderFeedbackList);
        document.getElementById('importFeedbackBtn').addEventListener('click', function () {
            document.getElementById('importFeedbackFile').click();
        });
        document.getElementById('importFeedbackFile').addEventListener('change', function (e) {
            if (e.target.files[0]) importFeedback(e.target.files[0]);
            e.target.value = '';
        });
        renderFeedbackList();
    }

    function renderFeedbackList() {
        const list = document.getElementById('feedbackList');
        if (!list) return;
        const statusFilter = (document.getElementById('feedbackStatusFilter') || {}).value || '';
        const typeFilter = (document.getElementById('feedbackTypeFilter') || {}).value || '';
        const filtered = state.feedback.filter(function (f) {
            if (statusFilter && f.status !== statusFilter) return false;
            if (typeFilter && f.type !== typeFilter) return false;
            return true;
        });
        if (!filtered.length) {
            list.innerHTML = '<div class="loading">暂无意见记录</div>';
            return;
        }
        list.innerHTML = filtered.map(function (f) {
            return '<div class="feedback-item"><div class="feedback-header">' +
                '<span class="feedback-title">' + esc(f.title) + '</span><div class="feedback-meta">' +
                '<span class="badge ' + getStatusBadge(f.status) + '">' + esc(getStatusLabel(f.status)) + '</span>' +
                '<span class="badge badge-neutral">' + esc(getTypeLabel(f.type)) + '</span>' +
                '<span class="badge badge-neutral">' + esc(f.version || 'D2A-R1') + '</span>' +
                (f.experiment ? '<span class="badge badge-info">' + esc(f.experiment) + '</span>' : '') +
                (f.symbol ? '<span class="badge badge-neutral">' + esc(f.symbol) + '</span>' : '') +
                '<span style="font-size:0.7rem;color:var(--text-muted);">' + esc(utilsDate(f.createdAt)) + '</span>' +
                '</div></div><div class="feedback-body">' +
                '<strong>当前观察：</strong> ' + esc(f.observation) + '<br>' +
                '<strong>希望修改：</strong> ' + esc(f.suggestion) + '<br>' +
                '<strong>修改原因：</strong> ' + esc(f.reason) + '<br>' +
                (f.needs_rebacktest ? '<strong class="badge badge-warning">需要重新回测</strong>' : '') +
                '</div><div class="feedback-actions">' +
                (f.status === 'pending' ? '<button class="btn btn-sm btn-primary" onclick="updateFeedbackStatus(\'' + f.id + '\', \'accepted\')">接受</button>' +
                    '<button class="btn btn-sm btn-secondary" onclick="updateFeedbackStatus(\'' + f.id + '\', \'rejected\')">拒绝</button>' : '') +
                (f.status === 'accepted' ? '<button class="btn btn-sm btn-primary" onclick="updateFeedbackStatus(\'' + f.id + '\', \'executed\')">标记执行</button>' : '') +
                '<button class="btn btn-sm btn-secondary" onclick="editFeedback(\'' + f.id + '\')">编辑</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="deleteFeedbackConfirm(\'' + f.id + '\')">删除</button>' +
                '<button class="btn btn-sm btn-secondary" onclick="copyTaskDraft(\'' + f.id + '\')">复制任务草稿</button>' +
                '</div></div>';
        }).join('');
    }

    function utilsDate(v) {
        if (!v) return '-';
        try { return new Date(v).toLocaleDateString('zh-CN'); } catch (e) { return '-'; }
    }

    function getStatusBadge(status) {
        const map = { pending: 'badge-warning', accepted: 'badge-success', rejected: 'badge-danger', executed: 'badge-info' };
        return map[status] || 'badge-neutral';
    }

    function getStatusLabel(status) {
        const map = { pending: '待讨论', accepted: '已接受', rejected: '已拒绝', executed: '已执行' };
        return map[status] || status;
    }

    function getTypeLabel(type) {
        const map = {
            buy_logic: '买入逻辑', sell_logic: '卖出逻辑', observation: '观察期',
            sector_judgment: '板块判断', market_judgment: '大盘判断', financial_judgment: '财务判断',
            candidate_ranking: '候选排序', capital_allocation: '资金分配', display: '页面展示',
            data_issue: '数据问题', other: '其他'
        };
        return map[type] || type;
    }

    let editingFeedbackId = null;

    function openFeedbackModal(feedback) {
        editingFeedbackId = feedback && feedback.id ? feedback.id : null;
        const form = els.feedbackForm;
        form.reset();
        if (feedback) {
            document.getElementById('feedbackId').value = feedback.id || '';
            document.getElementById('feedbackTitle').value = feedback.title || '';
            document.getElementById('feedbackType').value = feedback.type || '';
            document.getElementById('feedbackPriority').value = feedback.priority || 'medium';
            document.getElementById('feedbackVersion').value = feedback.version || 'RiskFixV1';
            document.getElementById('feedbackExperiment').value = feedback.experiment || '';
            document.getElementById('feedbackObservation').value = feedback.observation || '';
            document.getElementById('feedbackSuggestion').value = feedback.suggestion || '';
            document.getElementById('feedbackReason').value = feedback.reason || '';
            document.getElementById('feedbackNeedsRebacktest').checked = !!feedback.needs_rebacktest;
            document.getElementById('feedbackPage').value = feedback.page || state.currentPage;
            document.getElementById('feedbackDate').value = feedback.date || new Date().toISOString().slice(0, 10);
            document.getElementById('feedbackSymbol').value = feedback.symbol || '';
        } else {
            document.getElementById('feedbackPage').value = state.currentPage;
            document.getElementById('feedbackDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('feedbackExperiment').value = state.experimentId;
        }
        openModal(els.feedbackModal);
    }

    function closeFeedbackModal() {
        closeModal(els.feedbackModal);
        editingFeedbackId = null;
    }

    function handleFeedbackSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const data = {
            title: form.title.value.trim(),
            type: form.type.value,
            priority: form.priority.value,
            version: form.version.value,
            experiment: form.experiment.value,
            observation: form.observation.value.trim(),
            suggestion: form.suggestion.value.trim(),
            reason: form.reason.value.trim(),
            needs_rebacktest: form.needs_rebacktest.checked,
            page: form.page.value,
            date: form.date.value,
            symbol: form.symbol.value.trim().toUpperCase()
        };
        if (!data.title || !data.type || !data.observation || !data.suggestion || !data.reason) {
            showToast('请填写所有必填字段', 'error');
            return;
        }
        if (editingFeedbackId) {
            updateFeedback(editingFeedbackId, data);
            showToast('意见已更新', 'success');
        } else {
            addFeedback(data);
            showToast('意见已保存', 'success');
        }
        closeFeedbackModal();
        renderFeedbackList();
    }

    window.updateFeedbackStatus = function (id, status) {
        updateFeedback(id, { status: status });
        renderFeedbackList();
        showToast('已标记为' + getStatusLabel(status), 'success');
    };

    window.editFeedback = function (id) {
        const fb = state.feedback.find(function (f) { return f.id === id; });
        if (fb) openFeedbackModal(fb);
    };

    window.deleteFeedbackConfirm = function (id) {
        showConfirm('确定要删除这条意见吗？', function () {
            deleteFeedback(id);
            renderFeedbackList();
            showToast('已删除', 'success');
        });
    };

    window.copyTaskDraft = function (id) {
        const fb = state.feedback.find(function (f) { return f.id === id; });
        if (!fb) return;
        const draft = '# 执行 AI 任务草稿\n\n## 意见标题\n' + fb.title +
            '\n\n## 类型\n' + getTypeLabel(fb.type) + ' (' + fb.priority + ')' +
            '\n\n## 对应版本\n' + (fb.version || '') +
            '\n\n## 对应实验\n' + (fb.experiment || '未指定') +
            '\n\n## 对应页面\n' + (fb.page || '') +
            '\n\n## 对应日期\n' + (fb.date || '') +
            '\n\n## 对应股票\n' + (fb.symbol || '无') +
            '\n\n## 当前观察\n' + fb.observation +
            '\n\n## 希望修改的策略表达\n' + fb.suggestion +
            '\n\n## 修改原因\n' + fb.reason +
            '\n\n## 是否需要重新回测\n' + (fb.needs_rebacktest ? '是' : '否') +
            '\n\n---\n*来源：GoldOne 实验审阅台 - 用户修正意见*';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(draft).then(function () {
                showToast('任务草稿已复制到剪贴板', 'success');
            }).catch(function () {
                showToast('复制失败', 'error');
            });
        } else {
            showToast('浏览器不支持剪贴板', 'error');
        }
    };

    function initTheme() {
        const saved = localStorage.getItem('goldone_theme') || 'light';
        setTheme(saved);
    }

    function setTheme(theme) {
        state.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('goldone_theme', theme);
    }

    function toggleTheme() {
        setTheme(state.theme === 'light' ? 'dark' : 'light');
    }

    function setupExperimentSelect() {
        const c = contract();
        els.experimentSelect.innerHTML = c.experiments.map(function (e) {
            return '<option value="' + esc(e.id) + '">' + esc(e.label) + '</option>';
        }).join('');
        const saved = localStorage.getItem(EXPERIMENT_STORAGE_KEY);
        state.experimentId = (saved && c.by_id[saved]) ? saved : c.experiments[0].id;
        els.experimentSelect.value = state.experimentId;
        els.experimentSelect.addEventListener('change', function () {
            state.experimentId = els.experimentSelect.value;
            localStorage.setItem(EXPERIMENT_STORAGE_KEY, state.experimentId);
            state.filters.trades.experiment = state.experimentId;
            state.pagination.trades.page = 1;
            renderPage(state.currentPage);
        });
    }

    function setupEventListeners() {
        els.mainNav.addEventListener('click', function (e) {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                navigate(link.dataset.page);
            }
        });
        els.themeToggle.addEventListener('click', toggleTheme);
        els.exportFeedbackBtn.addEventListener('click', exportFeedback);
        els.feedbackModalClose.addEventListener('click', closeFeedbackModal);
        els.feedbackCancel.addEventListener('click', closeFeedbackModal);
        els.feedbackForm.addEventListener('submit', handleFeedbackSubmit);
        els.feedbackModal.addEventListener('click', function (e) {
            if (e.target === els.feedbackModal) closeFeedbackModal();
        });
        els.confirmCancel.addEventListener('click', function () { closeModal(els.confirmModal); });
        els.confirmOk.addEventListener('click', function () {
            if (confirmCallback) confirmCallback();
            closeModal(els.confirmModal);
            confirmCallback = null;
        });
        els.confirmModal.addEventListener('click', function (e) {
            if (e.target === els.confirmModal) closeModal(els.confirmModal);
        });
        els.viewManifestBtn.addEventListener('click', function (e) {
            e.preventDefault();
            showModalContent('Manifest', JSON.stringify(state.data.manifest, null, 2));
        });
        els.viewSecurityBtn.addEventListener('click', function (e) {
            e.preventDefault();
            fetch('data/security_scan.json').then(function (r) { return r.json(); }).then(function (d) {
                showModalContent('安全扫描报告', JSON.stringify(d, null, 2));
            }).catch(function () {
                showModalContent('安全扫描报告', '暂无数据');
            });
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeFeedbackModal();
                closeModal(els.confirmModal);
            }
        });
    }

    function showModalContent(title, content) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = '<div class="modal-content" style="max-width:800px;">' +
            '<div class="modal-header"><h2>' + esc(title) + '</h2>' +
            '<button class="modal-close" onclick="this.closest(\'.modal\').remove()">&times;</button></div>' +
            '<div class="card-body" style="max-height:60vh;overflow:auto;">' +
            '<pre style="font-size:0.75rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;">' + esc(content) + '</pre></div></div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.remove();
        });
    }

    async function init() {
        cacheElements();
        initTheme();
        setupEventListeners();
        await loadData();
        state.contract = buildContract();
        setupExperimentSelect();
        try {
            const savedVariant = localStorage.getItem('goldone_v2_variant');
            if (savedVariant === 'A' || savedVariant === 'C') state.v2.variant = savedVariant;
            const savedPeriod = localStorage.getItem('goldone_v2_period');
            if (savedPeriod === 'dev' || savedPeriod === 'new' || savedPeriod === 'full') state.v2.period = savedPeriod;
        } catch (e) { /* noop */ }
        const v2Badge = document.getElementById('v2Badge');
        if (v2Badge && state.data.v2_review) {
            v2Badge.textContent = 'V2 · P12-A_fixed / C 对照';
        }
        navigate('overview');
        window.GOLDONE = {
            getContract: function () { return contract(); },
            getState: function () { return state; },
            navigate: navigate,
            setExperiment: function (id) {
                if (!contract().by_id[id]) return false;
                state.experimentId = id;
                if (els.experimentSelect) els.experimentSelect.value = id;
                try { localStorage.setItem(EXPERIMENT_STORAGE_KEY, id); } catch (e) { /* noop */ }
                state.filters.trades.experiment = id;
                renderPage(state.currentPage);
                return true;
            },
            getV2: function () { return v2Data(); },
            getV2State: function () { return state.v2; },
            setV2Variant: function (g) {
                if (g !== 'A' && g !== 'C') return false;
                state.v2.variant = g;
                renderPage(state.currentPage);
                return true;
            },
            setV2Period: function (p) {
                if (['dev', 'new', 'full'].indexOf(p) < 0) return false;
                state.v2.period = p;
                renderPage(state.currentPage);
                return true;
            }
        };
        console.log('GoldOne Review Dashboard initialized (schema ' + SCHEMA_VERSION + ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
