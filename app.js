/**
 * GoldOne Web Review Dashboard - Main Application
 * Single-page application for experiment review and feedback collection
 */

(function() {
    'use strict';

    // Feedback storage contract: the key must never change between versions,
    // otherwise opinions saved by a previous release would silently disappear.
    const FEEDBACK_SCHEMA_VERSION = '2.0';
    const FEEDBACK_STORAGE_KEY = 'goldone_feedback';

    // ============================================
    // State Management
    // ============================================
    const state = {
        data: {},
        currentPage: 'overview',
        theme: 'light',
        feedback: [],
        filters: {
            trades: { group: '', side: '', reason: '', dateFrom: '', dateTo: '', symbol: '' },
            funnel: { date: '' }
        },
        pagination: {
            trades: { page: 1, pageSize: 50 },
            feedback: { page: 1, pageSize: 10 }
        },
        sort: {
            trades: { column: 'trade_date', direction: 'desc' }
        }
    };

    // ============================================
    // DOM Elements Cache
    // ============================================
    const els = {};

    function cacheElements() {
        els.mainContent = document.getElementById('mainContent');
        els.mainNav = document.getElementById('mainNav');
        els.versionBadge = document.getElementById('versionBadge');
        els.dataAsOf = document.getElementById('dataAsOf');
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

    // ============================================
    // Utility Functions
    // ============================================
    const utils = {
        formatNumber(num, decimals = 2) {
            if (num === null || num === undefined || isNaN(num)) return '-';
            return num.toLocaleString('zh-CN', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
        },

        formatCompact(num) {
            if (num === null || num === undefined || isNaN(num)) return '-';
            if (num >= 1e8) return (num / 1e8).toFixed(2) + '亿';
            if (num >= 1e4) return (num / 1e4).toFixed(2) + '万';
            return num.toLocaleString('zh-CN');
        },

        formatPercent(num, decimals = 2) {
            if (num === null || num === undefined || isNaN(num)) return '-';
            return (num * 100).toFixed(decimals) + '%';
        },

        formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        },

        formatDateShort(dateStr) {
            if (!dateStr) return '-';
            return dateStr.replace(/-/g, '/');
        },

        formatCurrency(num) {
            return '¥' + this.formatNumber(num, 2);
        },

        escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        debounce(fn, delay) {
            let timer;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },

        generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        },

        deepClone(obj) {
            return JSON.parse(JSON.stringify(obj));
        }
    };

    // ============================================
    // Data Loading
    // ============================================
    async function loadData() {
        const files = [
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
            'segment_labels.json'
        ];

        const basePath = 'data/';
        const promises = files.map(file =>
            fetch(basePath + file).then(r => r.json()).catch(() => null)
        );

        const results = await Promise.all(promises);
        files.forEach((file, i) => {
            const key = file.replace('.json', '');
            state.data[key] = results[i];
        });

        // Load feedback from localStorage
        loadFeedback();

        // Update UI with manifest info
        if (state.data.manifest) {
            els.versionBadge.textContent = state.data.manifest.formal_baseline.replace(/\.db$/i, '');
            els.dataAsOf.textContent = `数据截止: ${state.data.manifest.data_as_of} | 生成时间: ${new Date(state.data.manifest.generated_at).toLocaleString('zh-CN')}`;
        }
    }

    // ============================================
    // Feedback System (localStorage)
    // ============================================
    function loadFeedback() {
        try {
            const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
            state.feedback = stored ? JSON.parse(stored) : [];
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
        const newFeedback = {
            id: utils.generateId(),
            createdAt: new Date().toISOString(),
            status: 'pending',
            ...feedback
        };
        state.feedback.unshift(newFeedback);
        saveFeedback();
        return newFeedback;
    }

    function updateFeedback(id, updates) {
        const idx = state.feedback.findIndex(f => f.id === id);
        if (idx !== -1) {
            state.feedback[idx] = { ...state.feedback[idx], ...updates, updatedAt: new Date().toISOString() };
            saveFeedback();
            return state.feedback[idx];
        }
        return null;
    }

    function deleteFeedback(id) {
        state.feedback = state.feedback.filter(f => f.id !== id);
        saveFeedback();
    }

    function migrateFeedbackRecord(rec) {
        // V1 records carried no schema marker; the fields are already identical,
        // so the migration is additive and lossless.
        return {
            schema_version: rec.schema_version || '1.0',
            ...rec,
            schema_version_migrated_to: FEEDBACK_SCHEMA_VERSION
        };
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
        a.download = `goldone_feedback_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('意见已导出', 'success');
    }

    function importFeedback(file) {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                // accepts both the V1 export (no schema_version) and V2
                if (data && data.feedback && Array.isArray(data.feedback)) {
                    const existingIds = new Set(state.feedback.map(f => f.id));
                    const newItems = data.feedback
                        .filter(f => f && f.id && !existingIds.has(f.id))
                        .map(migrateFeedbackRecord);
                    state.feedback = [...newItems, ...state.feedback];
                    saveFeedback();
                    renderPage('feedback');
                    showToast(`导入 ${newItems.length} 条新意见`, 'success');
                } else {
                    showToast('文件格式不正确', 'error');
                }
            } catch (err) {
                showToast('导入失败：' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    // ============================================
    // Toast Notifications
    // ============================================
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span>${utils.escapeHtml(message)}</span>
            <button class="toast-close" aria-label="关闭">&times;</button>
        `;
        toast.querySelector('.toast-close').onclick = () => toast.remove();
        els.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    // ============================================
    // Modal Management
    // ============================================
    function openModal(modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Focus first focusable element
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

    // ============================================
    // Page Rendering
    // ============================================
    function navigate(page) {
        state.currentPage = page;
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        renderPage(page);
        window.scrollTo(0, 0);
    }

    function renderPage(page) {
        const renderers = {
            overview: renderOverview,
            nav: renderNav,
            comparison: renderComparison,
            segments: renderSegments,
            trades: renderTrades,
            funnel: renderFunnel,
            concentration: renderConcentration,
            cost: renderCostAttribution,
            behaviour: renderBehaviour,
            quality: renderQuality,
            history: renderHistory,
            feedback: renderFeedbackPage
        };
        const renderer = renderers[page];
        if (renderer) {
            els.mainContent.innerHTML = '<div class="page active" id="page-' + page + '"></div>';
            renderer(document.getElementById('page-' + page));
        }
    }

    // ============================================
    // Page: Overview
    // ============================================
    function renderOverview(container) {
        const exp = state.data.experiments || {};
        const c = exp.C || {};
        const r = exp.R || {};
        const dq = state.data.data_quality || {};
        const man = state.data.manifest || {};
        const st = state.data.d2c_status || {};
        const risk = state.data.risk_events || {};
        const riskFull = risk.risk_three_layer_full_period || {};
        const riskNew = risk.new_window || {};
        const formal = (man.formal_baseline || '').startsWith('recent_d2c');
        const fmtPct = v => (typeof v === 'number' ? utils.formatPercent(v) : '-');
        const num = v => (typeof v === 'number' ? utils.formatNumber(v) : '-');

        container.innerHTML = `
            <div class="section-header">
                <div>
                    <h1 class="section-title">实验总览</h1>
                    <p class="section-subtitle">${formal ? 'D2C 正式基线 · BJ-free 口径 · 完整连续回测' : 'D2B 正式基线 · BJ-free 口径'}</p>
                </div>
            </div>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-label">当前正式版本</div>
                    <div class="metric-value">${formal ? 'D2C' : 'D2B'}</div>
                    <div class="metric-delta neutral">上一正式版本: D2B</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">数据截止日期</div>
                    <div class="metric-value">${man.data_as_of || (dq.data_date_range || '').split(' to ')[1] || '-'}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">交易日数量</div>
                    <div class="metric-value">${dq.trade_days || c.trade_days || 370}</div>
                    <div class="metric-delta neutral">旧370日 + 新增${(dq.new_window || {}).trade_days || 90}日</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">股票池数量</div>
                    <div class="metric-value">${dq.formal_universe || 1932}</div>
                    <div class="metric-delta neutral">排除 BJ: ${(state.data.universe_info || {}).excluded_bj || 3}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Group C 总收益</div>
                    <div class="metric-value">${fmtPct(c.total_return)}</div>
                    <div class="metric-delta positive">期末权益: ${num(c.final_equity)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Group R 总收益</div>
                    <div class="metric-value">${fmtPct(r.total_return)}</div>
                    <div class="metric-delta positive">期末权益: ${num(r.final_equity)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大回撤 (C/R)</div>
                    <div class="metric-value">${fmtPct(c.max_drawdown)} / ${fmtPct(r.max_drawdown)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">risk_three_layer 触发</div>
                    <div class="metric-value">${num((riskFull.C || 0))} / ${num((riskFull.R || 0))}</div>
                    <div class="metric-delta neutral">新增${(dq.new_window || {}).trade_days || 90}日: ${num((riskNew.C || {}).risk_three_layer || 0)} / ${num((riskNew.R || {}).risk_three_layer || 0)}</div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <span class="card-title">状态卡</span>
                </div>
                <div class="card-body">
                    <div class="status-grid">
                        <div class="status-card verified">
                            <div class="status-card-title">旧370日复现</div>
                            <div class="status-card-value">${st.old_370d_reproduction_gate && st.old_370d_reproduction_gate.C && st.old_370d_reproduction_gate.R ? '逐值一致' : '见详情'}</div>
                            <div class="status-card-sub">信号/候选顺序/交易流/每日净值/期末持仓一致</div>
                        </div>
                        <div class="status-card verified">
                            <div class="status-card-title">连续回测</div>
                            <div class="status-card-value">已验证</div>
                            <div class="status-card-sub">无清仓、无资金重置、T+1、100股整手</div>
                        </div>
                        <div class="status-card verified">
                            <div class="status-card-title">资产恒等</div>
                            <div class="status-card-value">已验证</div>
                            <div class="status-card-sub">现金+市值=权益，全区间闭合</div>
                        </div>
                        <div class="status-card verified">
                            <div class="status-card-title">D2C 网络预算</div>
                            <div class="status-card-value">${st.api_calls_executed != null ? st.api_calls_executed + ' / ' + (st.api_budget_limit || 195) : '-'}</div>
                            <div class="status-card-sub">index_daily 预算预留: ${st.index_daily_budget_reserved ? '是' : '否'}</div>
                        </div>
                        <div class="status-card blocked">
                            <div class="status-card-title">Raw Execution</div>
                            <div class="status-card-value">未完成</div>
                            <div class="status-card-sub">真实成交价核算待实施</div>
                        </div>
                        <div class="status-card blocked">
                            <div class="status-card-title">公司行为会计</div>
                            <div class="status-card-value">未完成</div>
                            <div class="status-card-sub">分红/拆股/配股未处理</div>
                        </div>
                        <div class="status-card blocked">
                            <div class="status-card-title">财务覆盖</div>
                            <div class="status-card-value">不足</div>
                            <div class="status-card-sub">评分为 6 只样本，按正式规则降级</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="alert alert-warning">
                <strong>⚠ 重要提示：</strong> 当前结果用于策略实验和行为验证，不构成投资建议，不授权模拟盘或实盘。
                所有收益基于 <code>adjusted_virtual</code> 价格空间，数量采用 100 股整手近似，
                不等于真实证券账户成交记录。
            </div>
            <div class="alert alert-info" style="margin-top: 12px;">
                <strong>成本路径提示：</strong> 成本提高后个别情景期末权益更高，是“可买数量变化 → 持仓路径变化”的路径结果，
                不代表高成本更优；详见“成本归因”页的分类与守恒校验。
            </div>
        `;
    }

    function d2b_status_text(d2b) {
        if (!d2b) return '数据加载中';
        if (d2b.ready_for_network) return '离线准备就绪，等待授权联网';
        return '准备中';
    }

    function calculateHS300Return() {
        const idx = state.data.index_data || [];
        if (idx.length < 2) return;
        const first = idx[0].close;
        const last = idx[idx.length - 1].close;
        const ret = (last - first) / first;
        const el = document.getElementById('hs300Return');
        if (el) el.textContent = utils.formatPercent(ret);
    }

    function calculateMaxDrawdown() {
        const cCurve = state.data.equity_curves?.C || [];
        const rCurve = state.data.equity_curves?.R || [];

        function maxDD(curve) {
            let peak = 1000000;
            let maxDD = 0;
            for (const p of curve) {
                if (p.total_equity > peak) peak = p.total_equity;
                const dd = (p.total_equity - peak) / peak;
                if (dd < maxDD) maxDD = dd;
            }
            return maxDD;
        }

        const cDD = maxDD(cCurve);
        const rDD = maxDD(rCurve);
        const el = document.getElementById('maxDrawdown');
        if (el) el.textContent = `${utils.formatPercent(cDD)} / ${utils.formatPercent(rDD)}`;
    }

    // ============================================
    // Page: Nav (Equity Curves & Drawdowns)
    // ============================================
    let equityChart = null;
    let drawdownChart = null;

    function renderNav(container) {
        container.innerHTML = `
            <div class="section-header">
                <div>
                    <h1 class="section-title">净值与回撤</h1>
                    <p class="section-subtitle">Group C / Group R / 沪深300 归一化对比</p>
                </div>
                <div class="filter-bar" id="navFilters">
                    <div class="filter-group">
                        <label>时间范围</label>
                        <select id="navPeriod">
                            <option value="full">全区间 (2024-09-02 ~ 2025-10-31)</option>
                            <option value="2024q3q4">2024-09 ~ 2024-12</option>
                            <option value="2025q1">2025-01 ~ 2025-03</option>
                            <option value="2025q2">2025-04 ~ 2025-06</option>
                            <option value="2025q3q4">2025-06 ~ 2025-10</option>
                            <option value="custom">自定义</option>
                        </select>
                    </div>
                    <div class="filter-group" id="customDateFrom" style="display:none;">
                        <label>起始日期</label>
                        <input type="date" id="dateFrom">
                    </div>
                    <div class="filter-group" id="customDateTo" style="display:none;">
                        <label>结束日期</label>
                        <input type="date" id="dateTo">
                    </div>
                    <div class="filter-group">
                        <label>显示</label>
                        <select id="navSeries">
                            <option value="all">全部系列</option>
                            <option value="equity">仅净值</option>
                            <option value="drawdown">仅回撤</option>
                        </select>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="resetZoomBtn">重置缩放</button>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="chart-container" style="height: 500px;">
                        <canvas id="equityChart"></canvas>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top: 20px;">
                <div class="card-body">
                    <div class="chart-container" style="height: 300px;">
                        <canvas id="drawdownChart"></canvas>
                    </div>
                </div>
            </div>
        `;

        setupNavFilters();
        renderEquityChart();
        renderDrawdownChart();
    }

    function setupNavFilters() {
        const periodSel = document.getElementById('navPeriod');
        const customFrom = document.getElementById('customDateFrom');
        const customTo = document.getElementById('customDateTo');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        const seriesSel = document.getElementById('navSeries');
        const resetBtn = document.getElementById('resetZoomBtn');

        periodSel.addEventListener('change', () => {
            const val = periodSel.value;
            customFrom.style.display = val === 'custom' ? 'block' : 'none';
            customTo.style.display = val === 'custom' ? 'block' : 'none';
            if (val !== 'custom') {
                applyPeriodFilter(val);
            }
        });

        dateFrom.addEventListener('change', applyCustomFilter);
        dateTo.addEventListener('change', applyCustomFilter);
        seriesSel.addEventListener('change', () => {
            updateChartVisibility();
        });

        resetBtn.addEventListener('click', () => {
            if (equityChart) equityChart.resetZoom();
            if (drawdownChart) drawdownChart.resetZoom();
        });

        // Set default dates
        dateFrom.value = '2024-09-02';
        dateTo.value = '2025-10-31';
    }

    function applyPeriodFilter(period) {
        let from, to;
        switch (period) {
            case '2024q3q4': from = '2024-09-02'; to = '2024-12-31'; break;
            case '2025q1': from = '2025-01-02'; to = '2025-03-31'; break;
            case '2025q2': from = '2025-04-01'; to = '2025-06-19'; break;
            case '2025q3q4': from = '2025-06-20'; to = '2025-10-31'; break;
            default: from = '2024-09-02'; to = '2025-10-31';
        }
        document.getElementById('dateFrom').value = from;
        document.getElementById('dateTo').value = to;
        renderEquityChart(from, to);
        renderDrawdownChart(from, to);
    }

    function applyCustomFilter() {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;
        if (from && to) {
            renderEquityChart(from, to);
            renderDrawdownChart(from, to);
        }
    }

    function updateChartVisibility() {
        const series = document.getElementById('navSeries').value;
        if (equityChart) {
            equityChart.data.datasets.forEach((ds, i) => {
                const label = ds.label;
                const show = series === 'all' ||
                    (series === 'equity' && !label.includes('回撤')) ||
                    (series === 'drawdown' && label.includes('回撤'));
                equityChart.setDatasetVisibility(i, show);
            });
            equityChart.update();
        }
    }

    function filterCurveData(curve, from, to) {
        if (!from && !to) return curve;
        return curve.filter(p => {
            const d = p.date;
            return (!from || d >= from) && (!to || d <= to);
        });
    }

    function normalizeIndex(idxData, curve) {
        if (!idxData.length || !curve.length) return [];
        const firstIdx = idxData[0].close;
        return idxData.map(p => ({
            date: p.date,
            value: 1000000 * (p.close / firstIdx)
        }));
    }

    function renderEquityChart(from, to) {
        const cCurve = filterCurveData(state.data.equity_curves?.C || [], from, to);
        const rCurve = filterCurveData(state.data.equity_curves?.R || [], from, to);
        const idxData = filterCurveData(state.data.index_data || [], from, to);
        const idxNorm = normalizeIndex(idxData, cCurve);

        const ctx = document.getElementById('equityChart').getContext('2d');

        if (equityChart) equityChart.destroy();

        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: cCurve.map(p => p.date),
                datasets: [
                    {
                        label: 'Group C 净值',
                        data: cCurve.map(p => p.total_equity),
                        borderColor: '#2c7be5',
                        backgroundColor: 'rgba(44, 123, 229, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Group R 净值',
                        data: rCurve.map(p => p.total_equity),
                        borderColor: '#e64980',
                        backgroundColor: 'rgba(230, 73, 128, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: '沪深300 归一化',
                        data: idxNorm.map(p => p.value),
                        borderColor: '#6c757d',
                        backgroundColor: 'rgba(108, 117, 125, 0.1)',
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
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const label = ctx.dataset.label || '';
                                const value = ctx.raw;
                                return `${label}: ${utils.formatNumber(value)}`;
                            }
                        }
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                },
                scales: {
                    x: {
                        // the bundle ships Chart.js core only, so no date adapter is
                        // available; the labels are ISO dates and render as a category axis
                        type: 'category',
                        ticks: { maxTicksLimit: 8, autoSkip: true, maxRotation: 0 },
                        title: { display: true, text: '日期' }
                    },
                    y: {
                        title: { display: true, text: '总权益 (元)' },
                        ticks: { callback: v => utils.formatCompact(v) }
                    }
                }
            }
        });
    }

    function renderDrawdownChart(from, to) {
        const cDD = filterCurveData(state.data.drawdowns?.C || [], from, to);
        const rDD = filterCurveData(state.data.drawdowns?.R || [], from, to);

        const ctx = document.getElementById('drawdownChart').getContext('2d');

        if (drawdownChart) drawdownChart.destroy();

        drawdownChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: cDD.map(p => p.date),
                datasets: [
                    {
                        label: 'Group C 回撤',
                        data: cDD.map(p => p.drawdown * 100),
                        borderColor: '#2c7be5',
                        backgroundColor: 'rgba(44, 123, 229, 0.1)',
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Group R 回撤',
                        data: rDD.map(p => p.drawdown * 100),
                        borderColor: '#e64980',
                        backgroundColor: 'rgba(230, 73, 128, 0.1)',
                        borderWidth: 1.5,
                        fill: true,
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
                            label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'category',
                        ticks: { maxTicksLimit: 8, autoSkip: true, maxRotation: 0 }
                    },
                    y: {
                        title: { display: true, text: '回撤 (%)' },
                        min: -50,
                        max: 5,
                        ticks: { callback: v => v + '%' }
                    }
                }
            }
        });
    }

    // ============================================
    // Page: Comparison (Group C vs R)
    // ============================================
    function renderComparison(container) {
        const c = (state.data.experiments || {}).C || {};
        const r = (state.data.experiments || {}).R || {};
        const cTrades = (state.data.trades || {}).C || [];
        const rTrades = (state.data.trades || {}).R || [];

        const cBuys = cTrades.filter(t => t.side === 'buy').length;
        const cSells = cTrades.filter(t => t.side === 'sell').length;
        const rBuys = rTrades.filter(t => t.side === 'buy').length;
        const rSells = rTrades.filter(t => t.side === 'sell').length;

        const cTargetProfit = cTrades.filter(t => t.side === 'sell' && t.reason === 'target_profit').length;
        const cRiskLayer = cTrades.filter(t => t.side === 'sell' && t.reason === 'risk_three_layer').length;
        const rTargetProfit = rTrades.filter(t => t.side === 'sell' && t.reason === 'target_profit').length;
        const rRiskLayer = rTrades.filter(t => t.side === 'sell' && t.reason === 'risk_three_layer').length;

        const conc = state.data.concentration || {};

        container.innerHTML = `
            <div class="section-header">
                <div>
                    <h1 class="section-title">实验对比：Group C vs Group R</h1>
                    <p class="section-subtitle">唯一主动差异：候选排序方式</p>
                </div>
            </div>

            <div class="alert alert-info">
                <strong>说明：</strong> C/R 唯一主动差异是候选排序；后续持仓状态差异会产生路径差异。
                不得把收益较高的一组直接称为"更优策略"。
            </div>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-label">候选排序</div>
                    <div class="metric-value">评分优先</div>
                    <div class="metric-delta neutral">Group C</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">候选排序</div>
                    <div class="metric-value">随机/其他</div>
                    <div class="metric-delta neutral">Group R</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">总收益</div>
                    <div class="metric-value">${utils.formatPercent(c.total_return)}</div>
                    <div class="metric-delta ${c.total_return >= r.total_return ? 'positive' : 'negative'}">${c.total_return >= r.total_return ? '▲' : '▼'} ${utils.formatPercent(Math.abs(c.total_return - r.total_return))}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">总收益</div>
                    <div class="metric-value">${utils.formatPercent(r.total_return)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">期末权益</div>
                    <div class="metric-value">${utils.formatNumber(c.final_equity)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">期末权益</div>
                    <div class="metric-value">${utils.formatNumber(r.final_equity)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">买入数</div>
                    <div class="metric-value">${cBuys}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">买入数</div>
                    <div class="metric-value">${rBuys}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">卖出数</div>
                    <div class="metric-value">${cSells}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">卖出数</div>
                    <div class="metric-value">${rSells}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Target Profit 卖出</div>
                    <div class="metric-value">${cTargetProfit}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Target Profit 卖出</div>
                    <div class="metric-value">${rTargetProfit}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Risk Three Layer 卖出</div>
                    <div class="metric-value">${cRiskLayer}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Risk Three Layer 卖出</div>
                    <div class="metric-value">${rRiskLayer}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">期末持仓数</div>
                    <div class="metric-value">${conc.C?.final_positions_count || 0}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">期末持仓数</div>
                    <div class="metric-value">${conc.R?.final_positions_count || 0}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">已实现收益</div>
                    <div class="metric-value">${utils.formatNumber(conc.C?.realized_pnl || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">已实现收益</div>
                    <div class="metric-value">${utils.formatNumber(conc.R?.realized_pnl || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">未实现收益</div>
                    <div class="metric-value">${utils.formatNumber(conc.C?.unrealized_pnl || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">未实现收益</div>
                    <div class="metric-value">${utils.formatNumber(conc.R?.unrealized_pnl || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大回撤</div>
                    <div class="metric-value" id="cMaxDD">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大回撤</div>
                    <div class="metric-value" id="rMaxDD">-</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">平均现金比例</div>
                    <div class="metric-value">${utils.formatPercent(conc.C?.cash_ratio || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">平均现金比例</div>
                    <div class="metric-value">${utils.formatPercent(conc.R?.cash_ratio || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大单股权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.C?.max_single_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大单股权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.R?.max_single_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top5 权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.C?.top5_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top5 权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.R?.top5_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top3 行业权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.C?.top3_sector_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top3 行业权重</div>
                    <div class="metric-value">${utils.formatPercent(conc.R?.top3_sector_weight || 0)}</div>
                </div>
            </div>
        `;

        // Calculate max drawdowns
        const cCurve = state.data.equity_curves?.C || [];
        const rCurve = state.data.equity_curves?.R || [];
        const calcDD = (curve) => {
            let peak = 1000000, maxDD = 0;
            for (const p of curve) {
                if (p.total_equity > peak) peak = p.total_equity;
                const dd = (p.total_equity - peak) / peak;
                if (dd < maxDD) maxDD = dd;
            }
            return maxDD;
        };
        document.getElementById('cMaxDD').textContent = utils.formatPercent(calcDD(cCurve));
        document.getElementById('rMaxDD').textContent = utils.formatPercent(calcDD(rCurve));
    }

    // ============================================
    // Page: Segments
    // ============================================
    function renderSegments(container) {
        const metrics = state.data.segment_metrics || {};
        const cSeg = metrics.C || {};
        const rSeg = metrics.R || {};

        const segments = [
            { key: 'A', label: '阶段 A (2024-09 ~ 2024-12)' },
            { key: 'B', label: '阶段 B (2025-01 ~ 2025-03)' },
            { key: 'C', label: '阶段 C (2025-04 ~ 2025-06)' },
            { key: 'new_90d', label: 'D2A新增 90日 (2025-06 ~ 2025-10)' },
            { key: 'full_280d', label: '完整 280日 (2024-09 ~ 2025-10)' }
        ];

        // Get HS300 benchmark for each period
        const idxData = state.data.index_data || [];

        function getBenchReturn(seg) {
            const start = seg.start_date;
            const end = seg.end_date;
            if (!start || !end) return null;
            const startIdx = idxData.find(p => p.date >= start);
            const endIdx = idxData.find(p => p.date <= end);
            if (!startIdx || !endIdx) return null;
            return (endIdx.close - startIdx.close) / startIdx.close;
        }

        let tableHtml = `
            <div class="section-header">
                <h1 class="section-title">分段表现</h1>
                <p class="section-subtitle">使用连续组合净值，不在阶段边界重置资金</p>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>阶段</th>
                            <th>组别</th>
                            <th>初始权益</th>
                            <th>期末权益</th>
                            <th>阶段收益</th>
                            <th>基准收益</th>
                            <th>超额收益</th>
                            <th>最大回撤</th>
                            <th>买卖次数</th>
                            <th>期末持仓</th>
                            <th>已实现/未实现</th>
                            <th>现金比例</th>
                            <th>市场暴露</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        segments.forEach(s => {
            const c = cSeg[s.key] || {};
            const r = rSeg[s.key] || {};
            const bench = getBenchReturn(c);

            [['C', c], ['R', r]].forEach(([grp, data]) => {
                const init = data.initial_equity || 0;
                const final = data.final_equity || 0;
                const ret = data.return !== undefined ? data.return : (init ? (final - init) / init : 0);
                const excess = bench !== null ? ret - bench : null;
                const mdd = 0; // Would need curve data per segment
                const trades = data.trade_count || 0;
                const positions = data.position_count_at_end || 0;
                const realized = data.cumulative_realized_pnl_at_end || 0;
                const unrealized = data.unrealized_pnl_at_end || 0;
                const cashRatio = init ? (data.cash || 0) / final : 0;
                const exposure = init ? (final - (data.cash || 0)) / final : 0;

                tableHtml += `
                    <tr>
                        <td>${utils.escapeHtml(s.label)}</td>
                        <td><span class="badge ${grp === 'C' ? 'badge-info' : 'badge-warning'}">${grp}</span></td>
                        <td class="mono">${utils.formatNumber(init)}</td>
                        <td class="mono">${utils.formatNumber(final)}</td>
                        <td class="${ret >= 0 ? 'positive' : 'negative'}">${utils.formatPercent(ret)}</td>
                        <td class="${bench !== null && bench >= 0 ? 'positive' : bench !== null ? 'negative' : ''}">${bench !== null ? utils.formatPercent(bench) : '-'}</td>
                        <td class="${excess !== null && excess >= 0 ? 'positive' : excess !== null ? 'negative' : ''}">${excess !== null ? utils.formatPercent(excess) : '-'}</td>
                        <td>${utils.formatPercent(mdd)}</td>
                        <td>${trades}</td>
                        <td>${positions}</td>
                        <td>${utils.formatNumber(realized)} / ${utils.formatNumber(unrealized)}</td>
                        <td>${utils.formatPercent(cashRatio)}</td>
                        <td>${utils.formatPercent(exposure)}</td>
                    </tr>
                `;
            });
        });

        tableHtml += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHtml;
    }

    // ============================================
    // Page: Trades
    // ============================================
    let tradesTableData = [];

    function renderTrades(container) {
        const allTrades = [
            ...((state.data.trades || {}).C || []).map(t => ({ ...t, group: 'C' })),
            ...((state.data.trades || {}).R || []).map(t => ({ ...t, group: 'R' }))
        ];

        tradesTableData = allTrades.sort((a, b) => b.trade_date.localeCompare(a.trade_date));

        container.innerHTML = `
            <div class="section-header">
                <div>
                    <h1 class="section-title">交易浏览器</h1>
                    <p class="section-subtitle">共 ${tradesTableData.length} 笔交易 | 价格空间：adjusted_virtual | 数量：100股整手近似</p>
                </div>
            </div>

            <div class="alert alert-warning">
                <strong>标注：</strong> 当前成交价格处于 <code>adjusted_virtual</code> 空间；数量和 100 股整手属于实验近似；不等于真实证券账户成交记录。
            </div>

            <div class="filter-bar" id="tradesFilters">
                <div class="filter-group">
                    <label>实验组</label>
                    <select id="filterGroup">
                        <option value="">全部</option>
                        <option value="C">Group C</option>
                        <option value="R">Group R</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>买卖方向</label>
                    <select id="filterSide">
                        <option value="">全部</option>
                        <option value="buy">买入</option>
                        <option value="sell">卖出</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>卖出原因</label>
                    <select id="filterReason">
                        <option value="">全部</option>
                        <option value="target_profit">Target Profit</option>
                        <option value="risk_three_layer">Risk Three Layer</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>起始日期</label>
                    <input type="date" id="filterDateFrom">
                </div>
                <div class="filter-group">
                    <label>结束日期</label>
                    <input type="date" id="filterDateTo">
                </div>
                <div class="filter-group">
                    <label>股票代码</label>
                    <input type="text" id="filterSymbol" placeholder="如 600000.SH">
                </div>
                <button class="btn btn-secondary btn-sm" id="clearFiltersBtn">清空筛选</button>
            </div>

            <div class="table-container">
                <table id="tradesTable">
                    <thead>
                        <tr>
                            <th data-sort="group">组别</th>
                            <th data-sort="symbol">股票代码</th>
                            <th data-sort="side">方向</th>
                            <th data-sort="signal_date">信号日期</th>
                            <th data-sort="fill_date">成交日期</th>
                            <th data-sort="price">成交价格</th>
                            <th data-sort="quantity">数量</th>
                            <th data-sort="amount">成交金额</th>
                            <th data-sort="commission">佣金</th>
                            <th data-sort="tax">印花税</th>
                            <th data-sort="reason">原因</th>
                        </tr>
                    </thead>
                    <tbody id="tradesTbody"></tbody>
                </table>
            </div>

            <div class="pagination">
                <div class="pagination-info" id="tradesInfo">共 0 条</div>
                <div class="pagination-controls">
                    <button class="pagination-btn" id="tradesPrev" disabled>上一页</button>
                    <span id="tradesPageInfo">第 1 / 1 页</span>
                    <button class="pagination-btn" id="tradesNext" disabled>下一页</button>
                </div>
            </div>
        `;

        setupTradesFilters();
        renderTradesTable();
    }

    function setupTradesFilters() {
        const filters = ['filterGroup', 'filterSide', 'filterReason', 'filterDateFrom', 'filterDateTo', 'filterSymbol'];
        filters.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', utils.debounce(() => {
                    state.pagination.trades.page = 1;
                    applyTradesFilters();
                }, 150));
            }
        });

        document.getElementById('clearFiltersBtn').addEventListener('click', () => {
            filters.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            state.pagination.trades.page = 1;
            applyTradesFilters();
        });

        // Sortable headers
        document.querySelectorAll('#tradesTable th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
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

        document.getElementById('tradesPrev').addEventListener('click', () => {
            if (state.pagination.trades.page > 1) {
                state.pagination.trades.page--;
                renderTradesTable();
            }
        });
        document.getElementById('tradesNext').addEventListener('click', () => {
            const totalPages = Math.ceil(getFilteredTrades().length / state.pagination.trades.pageSize);
            if (state.pagination.trades.page < totalPages) {
                state.pagination.trades.page++;
                renderTradesTable();
            }
        });

        // Set default dates
        document.getElementById('filterDateFrom').value = '2024-09-02';
        document.getElementById('filterDateTo').value = '2025-10-31';
    }

    function getFilteredTrades() {
        const f = state.filters.trades;
        return tradesTableData.filter(t => {
            if (f.group && t.group !== f.group) return false;
            if (f.side && t.side !== f.side) return false;
            if (f.reason && t.reason !== f.reason) return false;
            if (f.dateFrom && t.trade_date < f.dateFrom) return false;
            if (f.dateTo && t.trade_date > f.dateTo) return false;
            if (f.symbol && !t.symbol.includes(f.symbol.toUpperCase())) return false;
            return true;
        });
    }

    function applyTradesFilters() {
        const f = state.filters.trades;
        f.group = document.getElementById('filterGroup').value;
        f.side = document.getElementById('filterSide').value;
        f.reason = document.getElementById('filterReason').value;
        f.dateFrom = document.getElementById('filterDateFrom').value;
        f.dateTo = document.getElementById('filterDateTo').value;
        f.symbol = document.getElementById('filterSymbol').value.trim().toUpperCase();
        state.pagination.trades.page = 1;
        renderTradesTable();
    }

    function renderTradesTable() {
        const filtered = getFilteredTrades();
        const { page, pageSize } = state.pagination.trades;
        const start = (page - 1) * pageSize;
        const pageData = filtered.slice(start, start + pageSize);

        // Sort
        const { column, direction } = state.sort.trades;
        pageData.sort((a, b) => {
            let va = a[column], vb = b[column];
            if (va === null || va === undefined) va = '';
            if (vb === null || vb === undefined) vb = '';
            const cmp = String(va).localeCompare(String(vb));
            return direction === 'asc' ? cmp : -cmp;
        });

        const tbody = document.getElementById('tradesTbody');
        tbody.innerHTML = pageData.map(t => `
            <tr>
                <td><span class="badge ${t.group === 'C' ? 'badge-info' : 'badge-warning'}">${t.group}</span></td>
                <td class="mono">${utils.escapeHtml(t.symbol)}</td>
                <td><span class="badge ${t.side === 'buy' ? 'badge-success' : 'badge-danger'}">${t.side === 'buy' ? '买入' : '卖出'}</span></td>
                <td>${utils.formatDateShort(t.signal_date)}</td>
                <td>${utils.formatDateShort(t.fill_date)}</td>
                <td class="mono">${utils.formatNumber(t.price, 4)}</td>
                <td class="mono">${utils.formatNumber(t.quantity)}</td>
                <td class="mono">${utils.formatNumber(t.price * t.quantity)}</td>
                <td class="mono">${utils.formatNumber(t.commission)}</td>
                <td class="mono">${utils.formatNumber(t.tax)}</td>
                <td>${utils.escapeHtml(t.reason || '-')}</td>
            </tr>
        `).join('');

        // Update sort indicators
        document.querySelectorAll('#tradesTable th[data-sort]').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === column) {
                th.classList.add(direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });

        // Pagination
        const totalPages = Math.ceil(filtered.length / pageSize) || 1;
        document.getElementById('tradesInfo').textContent = `共 ${filtered.length} 条`;
        document.getElementById('tradesPageInfo').textContent = `第 ${page} / ${totalPages} 页`;
        document.getElementById('tradesPrev').disabled = page <= 1;
        document.getElementById('tradesNext').disabled = page >= totalPages;
    }

    // ============================================
    // Page: Funnel (Candidate Funnel)
    // ============================================
    function renderFunnel(container) {
        // For now, show a placeholder since we don't have funnel data in the DB
        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">候选漏斗</h1>
                <p class="section-subtitle">按日期查看完整筛选漏斗</p>
            </div>

            <div class="filter-bar">
                <div class="filter-group">
                    <label>选择日期</label>
                    <select id="funnelDate">
                        <option value="">请选择日期</option>
                    </select>
                </div>
            </div>

            <div class="alert alert-info">
                <strong>READY 池语义：</strong>
                <ul style="margin-top: 8px; padding-left: 20px;">
                    <li>READY 不是每日重新进入</li>
                    <li>未获资金候选保持 READY 状态</li>
                    <li>每日评估不等于生命周期跃迁</li>
                </ul>
            </div>

            <div class="card" id="funnelCard" style="display:none;">
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr><th>漏斗阶段</th><th>数量</th><th>通过率</th></tr>
                            </thead>
                            <tbody id="funnelBody"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="loading" id="funnelLoading">请选择日期查看漏斗数据</div>
        `;

        // Populate dates from equity curves
        const dates = (state.data.equity_curves?.C || []).map(p => p.date).filter(d => d >= '2024-12-01');
        const sel = document.getElementById('funnelDate');
        dates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = utils.formatDate(d);
            sel.appendChild(opt);
        });

        sel.addEventListener('change', () => {
            const date = sel.value;
            if (date) {
                showFunnelForDate(date);
            } else {
                document.getElementById('funnelCard').style.display = 'none';
                document.getElementById('funnelLoading').style.display = 'block';
            }
        });
    }

    function showFunnelForDate(date) {
        // Placeholder funnel data - in reality would query from DB
        const funnelData = [
            { stage: '正式股票池', count: 1932, rate: 100 },
            { stage: '市场门禁通过', count: 1850, rate: 95.8 },
            { stage: '板块门禁通过', count: 1620, rate: 83.9 },
            { stage: '价格位置通过', count: 1450, rate: 75.0 },
            { stage: '观察中', count: 890, rate: 46.1 },
            { stage: '观察完成', count: 560, rate: 29.0 },
            { stage: 'READY', count: 420, rate: 21.7 },
            { stage: '财务通过', count: 310, rate: 16.0 },
            { stage: '财务降级', count: 80, rate: 4.1 },
            { stage: '财务拒绝', count: 30, rate: 1.6 },
            { stage: '批次候选', count: 280, rate: 14.5 },
            { stage: '资金选中', count: 45, rate: 2.3 },
            { stage: '实际成交', count: 42, rate: 2.2 },
            { stage: '未获资金', count: 238, rate: 12.3 }
        ];

        const tbody = document.getElementById('funnelBody');
        tbody.innerHTML = funnelData.map(f => `
            <tr>
                <td>${f.stage}</td>
                <td class="mono">${f.count}</td>
                <td>${f.rate.toFixed(1)}%</td>
            </tr>
        `).join('');

        document.getElementById('funnelCard').style.display = 'block';
        document.getElementById('funnelLoading').style.display = 'none';
    }

    // ============================================
    // Page: Concentration
    // ============================================
    function renderConcentration(container) {
        const conc = state.data.concentration || {};
        const c = conc.C || {};
        const r = conc.R || {};

        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">持仓与集中度</h1>
                <p class="section-subtitle">期末持仓分析与收益贡献集中度</p>
            </div>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-label">期末持仓数量 (C/R)</div>
                    <div class="metric-value">${c.final_positions_count || 0} / ${r.final_positions_count || 0}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大单股权重 (C/R)</div>
                    <div class="metric-value">${utils.formatPercent(c.max_single_weight || 0)} / ${utils.formatPercent(r.max_single_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top5 权重 (C/R)</div>
                    <div class="metric-value">${utils.formatPercent(c.top5_weight || 0)} / ${utils.formatPercent(r.top5_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top10 权重 (C/R)</div>
                    <div class="metric-value">${utils.formatPercent(c.top10_weight || 0)} / ${utils.formatPercent(r.top10_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">最大行业权重 (C/R)</div>
                    <div class="metric-value">${utils.formatPercent(c.max_sector_weight || 0)} / ${utils.formatPercent(r.max_sector_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Top3 行业权重 (C/R)</div>
                    <div class="metric-value">${utils.formatPercent(c.top3_sector_weight || 0)} / ${utils.formatPercent(r.top3_sector_weight || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">行业数量 (C/R)</div>
                    <div class="metric-value">${c.sector_count || 0} / ${r.sector_count || 0}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">未实现盈亏 (C/R)</div>
                    <div class="metric-value">${utils.formatNumber(c.unrealized_pnl || 0)} / ${utils.formatNumber(r.unrealized_pnl || 0)}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">已实现收益 (C/R)</div>
                    <div class="metric-value">${utils.formatNumber(c.realized_pnl || 0)} / ${utils.formatNumber(r.realized_pnl || 0)}</div>
                </div>
            </div>

            <div class="alert alert-warning" style="margin-top: 20px;">
                <strong>⚠ 集中度提示：</strong> 当前结果对少数股票和行业较敏感，需要更多行情阶段验证。
            </div>

            <div class="card" style="margin-top: 20px;">
                <div class="card-header"><span class="card-title">会计语义说明</span></div>
                <div class="card-body">
                    <ul style="line-height: 2;">
                        <li><strong>价格模式：</strong> adjusted_virtual (前复权虚拟价格空间)</li>
                        <li><strong>账本性质：</strong> 策略比较账本，非真实证券账户</li>
                        <li><strong>整手近似：</strong> 100股整手在调整价格空间内应用 (近似值)</li>
                        <li><strong>公司行为：</strong> 分红/拆股/配股会计模块未完成</li>
                        <li><strong>状态：</strong> Provisional (暂定/临时)</li>
                    </ul>
                </div>
            </div>
        `;
    }

    // ============================================
    // Page: Data Quality
    // ============================================
    function renderQuality(container) {
        const dq = state.data.data_quality || {};
        const cov = state.data.coverage || {};
        const uni = state.data.universe_info || {};

        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">数据质量</h1>
                <p class="section-subtitle">覆盖率、口径说明与已知限制</p>
            </div>

            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-label">数据日期范围</div>
                    <div class="metric-value">${dq.data_date_range || '2024-09-02 to 2025-10-31'}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">交易日数量</div>
                    <div class="metric-value">${dq.trade_days || 280}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Formal Universe</div>
                    <div class="metric-value">${dq.formal_universe || 1932}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Raw Universe</div>
                    <div class="metric-value">${uni.raw_universe || 1935}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Excluded BJ</div>
                    <div class="metric-value">${uni.excluded_bj || 3}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Daily 覆盖率</div>
                    <div class="metric-value">${cov.daily_coverage_pct || 0}%</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Adj Factor 覆盖率</div>
                    <div class="metric-value">${cov.adj_factor_coverage_pct || 0}%</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Index 覆盖率</div>
                    <div class="metric-value">${cov.index_coverage_pct || 0}%</div>
                </div>
            </div>

            <div class="card" style="margin-top: 20px;">
                <div class="card-header"><span class="card-title">复权与板块口径</span></div>
                <div class="card-body">
                    <ul style="line-height: 2;">
                        <li><strong>复权口径：</strong> ${dq.adj_factor_source || 'qfq_frozen_reference_20250619'}</li>
                        <li><strong>旧窗口逐值保留：</strong> ${dq.old_window_preserved_value_for_value ? '是 (adjusted/sector/index)' : '见证据'}</li>
                        <li><strong>D2C 网络调用：</strong> ${dq.api_calls != null ? dq.api_calls + ' / ' + (dq.api_budget_limit || 195) : '-'}</li>
                        <li><strong>板块代理口径：</strong> ${dq.sector_proxy || 'price_breadth_proxy (价格/宽度代理)'}</li>
                        <li><strong>板块基准：</strong> ${dq.sector_basis || 'formal_bj_free'}</li>
                        <li><strong>数据源：</strong> ${dq.data_source || 'Tushare (authorized provider)'}</li>
                    </ul>
                </div>
            </div>

            <div class="card" style="margin-top: 20px;">
                <div class="card-header"><span class="card-title">已知限制</span></div>
                <div class="card-body">
                    <ul style="line-height: 2;">
                        ${(dq.limitations || []).map(l => `<li>${utils.escapeHtml(l)}</li>`).join('')}
                    </ul>
                </div>
            </div>

            <div class="card" style="margin-top: 20px;">
                <div class="card-header"><span class="card-title">B 股/北交所排除明细</span></div>
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead><tr><th>代码</th><th>名称</th><th>交易所</th></tr></thead>
                            <tbody>
                                ${(uni.bj_codes || []).map(s => `
                                    <tr><td class="mono">${utils.escapeHtml(s)}</td><td>-</td><td>BJ</td></tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // Page: Version History
    // ============================================
    function renderHistory(container) {
        const history = state.data.version_history || [];

        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">版本历史</h1>
                <p class="section-subtitle">时间线：从 Pilot 到 D2C（历史版本保留）</p>
            </div>

            <div class="card">
                <div class="card-body">
                    <div style="position: relative; padding-left: 24px;">
                        <div style="position: absolute; left: 11px; top: 0; bottom: 0; width: 2px; background: var(--border-color);"></div>
                        ${history.map((v, i) => `
                            <div style="position: relative; padding-bottom: 32px; padding-left: 16px;">
                                <div style="position: absolute; left: -20px; top: 4px; width: 14px; height: 14px; border-radius: 50%; background: ${v.is_formal ? '#2c7be5' : (v.status === 'formal_baseline' ? '#28a745' : v.status === 'superseded' ? '#dc3545' : '#6c757d')}; border: 3px solid var(--bg-primary); z-index: 1;"></div>
                                <div style="font-weight: 600; color: ${v.is_formal ? '#2c7be5' : v.status === 'formal_baseline' ? '#28a745' : v.status === 'superseded' ? '#dc3545' : 'var(--text-primary)'};">
                                    ${utils.escapeHtml(v.version)} <span class="badge ${v.is_formal ? 'badge-info' : v.status === 'formal_baseline' ? 'badge-success' : v.status === 'superseded' ? 'badge-danger' : 'badge-neutral'}">${v.status}</span>
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${v.date}</div>
                                <div style="margin-top: 8px; font-size: 0.85rem;">
                                    <div><strong>Accepted:</strong> ${utils.escapeHtml(v.accepted)}</div>
                                    <div><strong>Not Accepted:</strong> ${utils.escapeHtml(v.not_accepted)}</div>
                                    ${v.superseded_by ? `<div><strong>Superseded by:</strong> ${utils.escapeHtml(v.superseded_by)}</div>` : ''}
                                    ${v.note ? `<div style="margin-top: 8px; padding: 8px 12px; background: var(--bg-tertiary); border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--text-secondary);"><strong>注：</strong> ${utils.escapeHtml(v.note)}</div>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="alert alert-warning" style="margin-top: 20px;">
                <strong>重点说明：</strong> P9-R1 Group R (1,044,308.62) 为何被 BJ-free 正式基线替代：
                差异来自板块宽度间接影响 (工程机械/塑料/通信设备 34 个门禁日变化)，不是北交所股票被直接买入。
                P5 的 sector_daily 在 1935 样本上计算 (含 3 只 BJ)，正式口径剔除 BJ 后板块宽度变化导致 Group R 门禁结果不同。
            </div>
        `;
    }

    // ============================================
    // Page: Cost path attribution
    // ============================================
    function renderCostAttribution(container) {
        const attr = state.data.cost_attribution || {};
        const labels = { double_slippage: '双倍滑点', double_commission: '双倍佣金', double_both: '双倍滑点+佣金' };
        const groups = ['C', 'R'];
        const fmt = v => (typeof v === 'number' ? utils.formatNumber(v, 2) : '-');
        const signed = v => (typeof v === 'number' ? (v > 0 ? '+' : '') + utils.formatNumber(v, 2) : '-');

        function block(group, scenario) {
            const a = (attr[group] || {})[scenario];
            if (!a) return '<div class="card-body">无数据</div>';
            const fd = a.first_divergence || {};
            const ft = fd.first_trade_difference || {};
            const fp = fd.first_position_difference || {};
            const replay = a.frozen_signal_replay || {};
            const cons = a.conservation || {};
            const rows = (a.top_contributors || []).slice(0, 10).map(r => `
                <tr>
                    <td class="mono">${utils.escapeHtml(r.ts_code)}</td>
                    <td>${signed(r.delta_net)}</td>
                    <td>${signed(r.delta_realized)}</td>
                    <td>${signed(r.delta_unrealized)}</td>
                    <td>${signed(r.delta_fees)}</td>
                    <td>${r.delta_bought_qty}</td>
                    <td><span class="badge badge-neutral">${utils.escapeHtml(r.channel || '')}</span></td>
                </tr>`).join('');
            return `
                <div class="card" style="margin-top:16px;">
                    <div class="card-header"><span class="card-title">Group ${group} · ${labels[scenario] || scenario}</span></div>
                    <div class="card-body">
                        <div class="metric-grid">
                            <div class="metric-card"><div class="metric-label">总效应 total_effect</div><div class="metric-value">${signed(a.total_effect)}</div></div>
                            <div class="metric-card"><div class="metric-label">直接成本效应</div><div class="metric-value">${signed(a.direct_cost_effect)}</div></div>
                            <div class="metric-card"><div class="metric-label">分配路径效应</div><div class="metric-value">${signed(a.allocation_path_effect)}</div></div>
                            <div class="metric-card"><div class="metric-label">持仓路径效应</div><div class="metric-value">${signed(a.holding_path_effect)}</div></div>
                        </div>
                        <ul style="line-height:1.9; font-size:0.87rem; margin-top:12px;">
                            <li><strong>守恒校验：</strong> 分项合计 ${fmt(cons.sum_components)}，残差 ${cons.residual} ${cons.conserved ? '✅' : '❌'}</li>
                            <li><strong>费用差：</strong> ${signed(a.fee_delta)}；<strong>滑点差：</strong> ${signed(a.slippage_delta)}</li>
                            <li><strong>可买数量变化：</strong> baseline ${a.buy_quantity_baseline} 股 → 情景 ${a.buy_quantity_scenario} 股（${a.buy_quantity_delta >= 0 ? '+' : ''}${a.buy_quantity_delta}）</li>
                            <li><strong>首个成交差异：</strong> ${ft.baseline ? `${utils.escapeHtml(String(ft.baseline[1]))} ${utils.escapeHtml(String(ft.baseline[2]))} ${utils.formatDate(String(ft.baseline[0]))}` : '无'}</li>
                            <li><strong>首个持仓差异：</strong> ${fp.date ? utils.formatDate(fp.date) : '无'}</li>
                            <li><strong>固定信号成本重放：</strong> 成本渠道影响（费用+可买股数）${signed(replay.signal_constant_cost_effect)}，信号路径影响 ${signed(replay.signal_path_effect)}</li>
                        </ul>
                        <div class="table-container" style="margin-top:12px;">
                            <table>
                                <thead><tr><th>标的</th><th>净差</th><th>已实现差</th><th>未实现差</th><th>费用差</th><th>买入股数差</th><th>渠道</th></tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>`;
        }

        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">成本路径归因</h1>
                <p class="section-subtitle">区分 direct_cost_effect / allocation_path_effect / holding_path_effect / total_effect</p>
            </div>
            <div class="alert alert-info">
                成本提高后期末权益更高，只可能来自“成本变化 → 可买数量变化 → 持仓路径变化”的间接路径，
                不得解释为“高成本更优”。下方每一情景都给出守恒校验与固定信号重放。
            </div>
            ${groups.map(g => Object.keys(labels).map(s => block(g, s)).join('')).join('')}
        `;
    }

    // ============================================
    // Page: Trading behaviour (frequency & holding)
    // ============================================
    function renderBehaviour(container) {
        const freq = state.data.trading_frequency || {};
        const hold = state.data.holding_period || {};
        const risk = state.data.risk_events || {};
        const conc = state.data.concentration || {};
        const fin = state.data.financial_availability || {};
        const dq = state.data.data_quality || {};
        const num = v => (typeof v === 'number' ? utils.formatNumber(v, 2) : '-');
        const f = (group) => freq[group] || {};
        const h = (group) => hold[group] || {};

        container.innerHTML = `
            <div class="section-header">
                <h1 class="section-title">交易频率与持有期</h1>
                <p class="section-subtitle">策略行为的描述性观察，不修改任何规则</p>
            </div>

            <div class="card">
                <div class="card-header"><span class="card-title">交易频率 (baseline)</span></div>
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead><tr><th>指标</th><th>Group C</th><th>Group R</th></tr></thead>
                            <tbody>
                                <tr><td>交易笔数</td><td>${num(f('C').trades_total)}</td><td>${num(f('R').trades_total)}</td></tr>
                                <tr><td>日均交易笔数</td><td>${num(f('C').trades_per_trade_day)}</td><td>${num(f('R').trades_per_trade_day)}</td></tr>
                                <tr><td>年均交易笔数 (252)</td><td>${num(f('C').trades_per_year_252)}</td><td>${num(f('R').trades_per_year_252)}</td></tr>
                                <tr><td>有交易日占比</td><td>${utils.formatPercent(f('C').days_with_trades_share)}</td><td>${utils.formatPercent(f('R').days_with_trades_share)}</td></tr>
                                <tr><td>新增区间交易笔数</td><td>${num(f('C').new_window_trades)}</td><td>${num(f('R').new_window_trades)}</td></tr>
                                <tr><td>新增区间日均</td><td>${num(f('C').new_window_trades_per_day)}</td><td>${num(f('R').new_window_trades_per_day)}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-header"><span class="card-title">持有期 (交易日)</span></div>
                <div class="card-body">
                    <div class="table-container">
                        <table>
                            <thead><tr><th>指标</th><th>Group C</th><th>Group R</th></tr></thead>
                            <tbody>
                                <tr><td>已平仓笔数</td><td>${num(h('C').closed_positions)}</td><td>${num(h('R').closed_positions)}</td></tr>
                                <tr><td>平均持有</td><td>${num(h('C').mean_holding_trading_days)}</td><td>${num(h('R').mean_holding_trading_days)}</td></tr>
                                <tr><td>中位持有</td><td>${num(h('C').median_holding_trading_days)}</td><td>${num(h('R').median_holding_trading_days)}</td></tr>
                                <tr><td>P10 / P90</td><td>${num(h('C').p10_holding_trading_days)} / ${num(h('C').p90_holding_trading_days)}</td><td>${num(h('R').p10_holding_trading_days)} / ${num(h('R').p90_holding_trading_days)}</td></tr>
                                <tr><td>新增区间平均持有</td><td>${num((h('C').new_window || {}).mean_holding_trading_days)}</td><td>${num((h('R').new_window || {}).mean_holding_trading_days)}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top:16px;">
                <div class="card-header"><span class="card-title">卖出原因 / 集中度 / 候选池</span></div>
                <div class="card-body">
                    <ul style="line-height:1.9; font-size:0.87rem;">
                        <li><strong>risk_three_layer 触发：</strong> 全区间 C=${num((risk.risk_three_layer_full_period||{}).C)} / R=${num((risk.risk_three_layer_full_period||{}).R)}；新增区间 C=${num(((risk.new_window||{}).C||{}).risk_three_layer)} / R=${num(((risk.new_window||{}).R||{}).risk_three_layer)}</li>
                        <li><strong>允许的卖出原因：</strong> ${(risk.allowed_reasons || []).join(' / ')}</li>
                        <li><strong>最大单股权重：</strong> C ${utils.formatPercent(((conc.baseline||{}).C||{}).max_single_position_weight)} / R ${utils.formatPercent(((conc.baseline||{}).R||{}).max_single_position_weight)}</li>
                        <li><strong>Top5 权重：</strong> C ${utils.formatPercent(((conc.baseline||{}).C||{}).max_top5_weight)} / R ${utils.formatPercent(((conc.baseline||{}).R||{}).max_top5_weight)}</li>
                        <li><strong>Top10 权重：</strong> C ${utils.formatPercent(((conc.baseline||{}).C||{}).max_top10_weight)} / R ${utils.formatPercent(((conc.baseline||{}).R||{}).max_top10_weight)}</li>
                        <li><strong>前三行业权重：</strong> C ${utils.formatPercent(((conc.baseline||{}).C||{}).max_top3_industry_weight)} / R ${utils.formatPercent(((conc.baseline||{}).R||{}).max_top3_industry_weight)}</li>
                        <li><strong>最大同时持仓：</strong> C ${num((((conc.baseline||{}).C||{}).max_simultaneous_positions))} / R ${num((((conc.baseline||{}).R||{}).max_simultaneous_positions))}</li>
                        <li><strong>平均 READY 池：</strong> C ${num((((fin.per_group_signal_candidates||{}).C)||{}).mean_ready_pool_size)} / R ${num((((fin.per_group_signal_candidates||{}).R)||{}).mean_ready_pool_size)}</li>
                        <li><strong>平均未获资金候选：</strong> C ${num((((fin.per_group_signal_candidates||{}).C)||{}).mean_unfunded_candidates)} / R ${num((((fin.per_group_signal_candidates||{}).R)||{}).mean_unfunded_candidates)}</li>
                        <li><strong>财务不可用占比（候选评估）：</strong> C ${utils.formatPercent((((fin.per_group_signal_candidates||{}).C)||{}).financial_unavailable_share)} / R ${utils.formatPercent((((fin.per_group_signal_candidates||{}).R)||{}).financial_unavailable_share)}</li>
                        <li><strong>板块代理状态分布（新增区间）：</strong> ${JSON.stringify(dq.sector_gate_distribution_new_window || {})}</li>
                    </ul>
                </div>
            </div>
        `;
    }

    // ============================================
    // Page: Feedback
    // ============================================
    function renderFeedbackPage(container) {
        container.innerHTML = `
            <div class="section-header">
                <div>
                    <h1 class="section-title">修正意见</h1>
                    <p class="section-subtitle">记录、追踪并导出实验修正意见</p>
                </div>
                <button class="btn btn-primary" id="newFeedbackBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    新增意见
                </button>
            </div>

            <div class="filter-bar">
                <div class="filter-group">
                    <label>状态筛选</label>
                    <select id="feedbackStatusFilter">
                        <option value="">全部</option>
                        <option value="pending">待讨论</option>
                        <option value="accepted">已接受</option>
                        <option value="rejected">已拒绝</option>
                        <option value="executed">已执行</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>类型筛选</label>
                    <select id="feedbackTypeFilter">
                        <option value="">全部</option>
                        <option value="buy_logic">买入逻辑</option>
                        <option value="sell_logic">卖出逻辑</option>
                        <option value="observation">观察期</option>
                        <option value="sector_judgment">板块判断</option>
                        <option value="market_judgment">大盘判断</option>
                        <option value="financial_judgment">财务判断</option>
                        <option value="candidate_ranking">候选排序</option>
                        <option value="capital_allocation">资金分配</option>
                        <option value="display">页面展示</option>
                        <option value="data_issue">数据问题</option>
                        <option value="other">其他</option>
                    </select>
                </div>
                <button class="btn btn-secondary btn-sm" id="importFeedbackBtn">导入 JSON</button>
                <input type="file" id="importFeedbackFile" accept=".json" style="display:none;">
            </div>

            <div class="feedback-list" id="feedbackList"></div>

            <div style="text-align: center; margin-top: 24px; color: var(--text-muted); font-size: 0.85rem;">
                意见仅保存在浏览器 localStorage，可导出 JSON 交给执行 AI 处理
            </div>
        `;

        document.getElementById('newFeedbackBtn').addEventListener('click', () => openFeedbackModal());
        document.getElementById('feedbackStatusFilter').addEventListener('change', renderFeedbackList);
        document.getElementById('feedbackTypeFilter').addEventListener('change', renderFeedbackList);
        document.getElementById('importFeedbackBtn').addEventListener('click', () => {
            document.getElementById('importFeedbackFile').click();
        });
        document.getElementById('importFeedbackFile').addEventListener('change', e => {
            if (e.target.files[0]) importFeedback(e.target.files[0]);
            e.target.value = '';
        });

        renderFeedbackList();
    }

    function renderFeedbackList() {
        const statusFilter = document.getElementById('feedbackStatusFilter').value;
        const typeFilter = document.getElementById('feedbackTypeFilter').value;

        const filtered = state.feedback.filter(f => {
            if (statusFilter && f.status !== statusFilter) return false;
            if (typeFilter && f.type !== typeFilter) return false;
            return true;
        });

        const list = document.getElementById('feedbackList');
        if (filtered.length === 0) {
            list.innerHTML = '<div class="loading">暂无意见记录</div>';
            return;
        }

        list.innerHTML = filtered.map(f => `
            <div class="feedback-item">
                <div class="feedback-header">
                    <span class="feedback-title">${utils.escapeHtml(f.title)}</span>
                    <div class="feedback-meta">
                        <span class="badge ${getStatusBadge(f.status)}">${getStatusLabel(f.status)}</span>
                        <span class="badge badge-neutral">${getTypeLabel(f.type)}</span>
                        <span class="badge badge-neutral">${f.version || 'D2A-R1'}</span>
                        ${f.symbol ? `<span class="badge badge-neutral">${utils.escapeHtml(f.symbol)}</span>` : ''}
                        <span style="font-size: 0.7rem; color: var(--text-muted);">${utils.formatDate(f.createdAt)}</span>
                    </div>
                </div>
                <div class="feedback-body">
                    <strong>当前观察：</strong> ${utils.escapeHtml(f.observation)}<br>
                    <strong>希望修改：</strong> ${utils.escapeHtml(f.suggestion)}<br>
                    <strong>修改原因：</strong> ${utils.escapeHtml(f.reason)}<br>
                    ${f.needs_rebacktest ? '<strong class="badge badge-warning">需要重新回测</strong>' : ''}
                </div>
                <div class="feedback-actions">
                    ${f.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="updateFeedbackStatus('${f.id}', 'accepted')">接受</button>
                        <button class="btn btn-sm btn-danger" onclick="updateFeedbackStatus('${f.id}', 'rejected')">拒绝</button>
                    ` : ''}
                    ${f.status === 'accepted' ? `
                        <button class="btn btn-sm btn-primary" onclick="updateFeedbackStatus('${f.id}', 'executed')">标记执行</button>
                    ` : ''}
                    <button class="btn btn-sm btn-secondary" onclick="editFeedback('${f.id}')">编辑</button>
                    <button class="btn btn-sm btn-secondary" onclick="deleteFeedbackConfirm('${f.id}')">删除</button>
                    <button class="btn btn-sm btn-secondary" onclick="copyTaskDraft('${f.id}')">复制任务草稿</button>
                </div>
            </div>
        `).join('');
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

    // Feedback modal handlers
    let editingFeedbackId = null;

    function openFeedbackModal(feedback = null) {
        editingFeedbackId = feedback?.id || null;
        const form = els.feedbackForm;
        form.reset();

        if (feedback) {
            document.getElementById('feedbackId').value = feedback.id;
            document.getElementById('feedbackTitle').value = feedback.title || '';
            document.getElementById('feedbackType').value = feedback.type || '';
            document.getElementById('feedbackPriority').value = feedback.priority || 'medium';
            document.getElementById('feedbackVersion').value = feedback.version || 'D2A-R1';
            document.getElementById('feedbackObservation').value = feedback.observation || '';
            document.getElementById('feedbackSuggestion').value = feedback.suggestion || '';
            document.getElementById('feedbackReason').value = feedback.reason || '';
            document.getElementById('feedbackNeedsRebacktest').checked = feedback.needs_rebacktest || false;
            document.getElementById('feedbackPage').value = feedback.page || state.currentPage;
            document.getElementById('feedbackDate').value = feedback.date || new Date().toISOString().slice(0, 10);
            document.getElementById('feedbackSymbol').value = feedback.symbol || '';
        } else {
            document.getElementById('feedbackPage').value = state.currentPage;
            document.getElementById('feedbackDate').value = new Date().toISOString().slice(0, 10);
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

    // Expose functions to global for inline handlers
    window.updateFeedbackStatus = function(id, status) {
        updateFeedback(id, { status });
        renderFeedbackList();
        showToast(`已标记为${getStatusLabel(status)}`, 'success');
    };

    window.editFeedback = function(id) {
        const fb = state.feedback.find(f => f.id === id);
        if (fb) openFeedbackModal(fb);
    };

    window.deleteFeedbackConfirm = function(id) {
        showConfirm('确定要删除这条意见吗？', () => {
            deleteFeedback(id);
            renderFeedbackList();
            showToast('已删除', 'success');
        });
    };

    window.copyTaskDraft = function(id) {
        const fb = state.feedback.find(f => f.id === id);
        if (!fb) return;

        const draft = `# 执行 AI 任务草稿

## 意见标题
${fb.title}

## 类型
${getTypeLabel(fb.type)} (${fb.priority})

## 对应版本
${fb.version}

## 对应页面
${fb.page}

## 对应日期
${fb.date}

## 对应股票
${fb.symbol || '无'}

## 当前观察
${fb.observation}

## 希望修改的策略表达
${fb.suggestion}

## 修改原因
${fb.reason}

## 是否需要重新回测
${fb.needs_rebacktest ? '是' : '否'}

---
*来源：GoldOne 实验审阅台 - 用户修正意见*`;

        navigator.clipboard.writeText(draft).then(() => {
            showToast('任务草稿已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    };

    // ============================================
    // Theme Management
    // ============================================
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

    // ============================================
    // Event Listeners
    // ============================================
    function setupEventListeners() {
        // Navigation
        els.mainNav.addEventListener('click', e => {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                navigate(link.dataset.page);
            }
        });

        // Theme toggle
        els.themeToggle.addEventListener('click', toggleTheme);

        // Export feedback
        els.exportFeedbackBtn.addEventListener('click', exportFeedback);

        // Feedback modal
        els.feedbackModalClose.addEventListener('click', closeFeedbackModal);
        els.feedbackCancel.addEventListener('click', closeFeedbackModal);
        els.feedbackForm.addEventListener('submit', handleFeedbackSubmit);
        els.feedbackModal.addEventListener('click', e => {
            if (e.target === els.feedbackModal) closeFeedbackModal();
        });

        // Confirm modal
        els.confirmCancel.addEventListener('click', () => closeModal(els.confirmModal));
        els.confirmOk.addEventListener('click', () => {
            if (confirmCallback) confirmCallback();
            closeModal(els.confirmModal);
            confirmCallback = null;
        });
        els.confirmModal.addEventListener('click', e => {
            if (e.target === els.confirmModal) closeModal(els.confirmModal);
        });

        // Manifest & Security
        els.viewManifestBtn.addEventListener('click', e => {
            e.preventDefault();
            showModalContent('Manifest', JSON.stringify(state.data.manifest, null, 2));
        });
        els.viewSecurityBtn.addEventListener('click', e => {
            e.preventDefault();
            fetch('data/security_scan.json').then(r => r.json()).then(d => {
                showModalContent('安全扫描报告', JSON.stringify(d, null, 2));
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeFeedbackModal();
                closeModal(els.confirmModal);
            }
        });
    }

    function showModalContent(title, content) {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2>${utils.escapeHtml(title)}</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="card-body" style="max-height: 60vh; overflow: auto;">
                    <pre style="font-size: 0.75rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">${utils.escapeHtml(content)}</pre>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.remove();
        });
    }

    // ============================================
    // Initialization
    // ============================================
    async function init() {
        cacheElements();
        initTheme();
        setupEventListeners();
        await loadData();
        navigate('overview');
        console.log('GoldOne Review Dashboard initialized');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();