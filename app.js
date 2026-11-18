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
        'reconciliation.json'
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

    const charts = { equity: null, drawdown: null, compare: null };

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

    const renderers = {
        overview: renderOverview,
        nav: renderNav,
        comparison: renderComparison,
        segments: renderSegments,
        trades: renderTrades,
        riskfix: renderRiskFix,
        concentration: renderConcentration,
        cost: renderCostAttribution,
        behaviour: renderBehaviour,
        quality: renderQuality,
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
                    status: p.status
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
                    cumulative_realized_pnl: pnlData ? pnlData.cumulative_realized_pnl : null
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
                '<td>' + pnlCell(netPnl, t.unknown_fields && t.unknown_fields.length ? t.unknown_fields.join(', ') : 'P&L数据缺失') + '</td>' +
                '<td>' + pnlCell(netReturn, null, 4, true) + '</td>' +
                '<td class="mono">' + (fmt.isNum(holding) ? holding : (isSell ? naInline('缺持有期') : absentZero('不适用'))) + '</td>' +
                '<td>' + pnlCell(cumPnl, null) + '</td>' +
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
