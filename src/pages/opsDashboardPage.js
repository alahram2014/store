import { dom } from '../core/dom.js';
import { formatMoney } from '../services/invoiceService.js';
import { createOpsDashboardModel } from '../services/opsDashboardService.js';
import { getOperationalModuleByKey, isOperationalModuleReady } from '../services/managerService.js';
import { resolveWorkflowActions, getWorkflowStateLabel, normalizeWorkflowStateKey } from '../services/workflowService.js';

const HOME_MODULE_KEYS = ['orders', 'customers', 'products', 'categories', 'companies', 'users', 'reps', 'reports', 'workflow'];

function text(value, fallback = '') {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw || fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeId(value) {
  return text(value);
}

function dedupeByKey(rows = [], keys = ['id']) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const key = keys.map((field) => normalizeId(row?.[field])).find(Boolean) || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDate(value, locale = 'ar-EG') {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function normalizeOrderState(order) {
  return normalizeWorkflowStateKey(order?.workflow_state_key || order?.workflow_status || order?.status) || 'pending';
}

function getOrders(state) {
  const orders = [
    ...(Array.isArray(state?.runtime?.manager?.teamOrders) ? state.runtime.manager.teamOrders : []),
    ...(Array.isArray(state?.commerce?.invoices) ? state.commerce.invoices : []),
  ];
  return dedupeByKey(orders, ['id', 'order_number', 'invoice_number']);
}

function getCustomers(state) {
  return dedupeByKey(state?.runtime?.manager?.teamCustomers || state?.commerce?.customers || [], ['id']);
}

function getReps(state) {
  return dedupeByKey(state?.runtime?.manager?.teamReps || [], ['id']);
}

function getCompanies(state) {
  return dedupeByKey(state?.commerce?.catalog?.companies || [], ['company_id', 'id']);
}

function getProducts(state) {
  return Object.values(state?.commerce?.catalog?.productIndex || {})
    .filter((product) => product && product.product_id)
    .sort((a, b) => String(a.product_name || '').localeCompare(String(b.product_name || ''), 'ar'));
}

function getCategories(state) {
  const catalogProducts = getProducts(state);
  const categories = new Map();
  for (const product of catalogProducts) {
    const key = text(product.category || product.category_name || product.category_key || '—', '—');
    if (!categories.has(key)) {
      categories.set(key, {
        id: key,
        name: key,
        products: 0,
        visible: product.visible !== false,
      });
    }
    const entry = categories.get(key);
    entry.products += 1;
    entry.visible = entry.visible && product.visible !== false;
  }
  return Array.from(categories.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

function getSystemUsers(state) {
  return getReps(state);
}

function getTrendSeries(orders, days = 7) {
  const series = Array.from({ length: days }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (days - index - 1));
    return { label: day.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }), value: 0, time: day.getTime() };
  });

  for (const order of orders) {
    const timestamp = new Date(order?.created_at || order?.updated_at || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const dt = new Date(timestamp);
    dt.setHours(0, 0, 0, 0);
    const bucket = series.find((item) => item.time === dt.getTime());
    if (bucket) bucket.value += 1;
  }

  return series;
}

function getStateBuckets(orders) {
  const buckets = [
    { key: 'pending', label: 'قيد المراجعة', tone: 'danger' },
    { key: 'reviewing', label: 'تحت المراجعة', tone: 'warning' },
    { key: 'preparing', label: 'جاري التحضير', tone: 'info' },
    { key: 'dispatched', label: 'خرج للشحن', tone: 'success' },
    { key: 'delivered', label: 'تم التسليم', tone: 'accent' },
    { key: 'returned', label: 'مرتجعات', tone: 'muted' },
    { key: 'cancelled', label: 'ملغي', tone: 'muted' },
  ];
  return buckets.map((bucket) => ({
    ...bucket,
    value: orders.filter((order) => normalizeOrderState(order) === bucket.key).length,
  }));
}

function getCounters(state, model) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const reps = getReps(state);
  const preparing = orders.filter((order) => normalizeOrderState(order) === 'preparing').length;
  const pending = orders.filter((order) => ['pending', 'reviewing'].includes(normalizeOrderState(order))).length;
  const dispatched = orders.filter((order) => normalizeOrderState(order) === 'dispatched').length;
  const overdue = orders.filter((order) => ['pending', 'reviewing', 'preparing'].includes(normalizeOrderState(order)) && (Date.now() - new Date(order.created_at || order.updated_at || 0).getTime()) > 48 * 3600 * 1000).length;
  const returns = orders.filter((order) => normalizeOrderState(order) === 'returned').length;
  const followUp = customers.filter((customer) => {
    const latest = orders.filter((order) => normalizeId(order.customer_id) === normalizeId(customer.id)).sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
    if (!latest) return true;
    const hours = (Date.now() - new Date(latest.updated_at || latest.created_at || 0).getTime()) / 36e5;
    return Number.isFinite(hours) && hours > 24 * 21;
  }).length;

  return [
    { label: 'طلبات جديدة', value: model?.workflowSummary?.pending ?? pending, hint: 'workflow_state_key = pending' },
    { label: 'قيد المراجعة', value: model?.workflowSummary?.reviewing ?? pending, hint: 'طابور المراجعة' },
    { label: 'جاري التحضير', value: model?.workflowSummary?.preparing ?? preparing, hint: 'طابور المخزن' },
    { label: 'خرج للشحن', value: model?.workflowSummary?.dispatched ?? dispatched, hint: 'طابور الشحن' },
    { label: 'متأخرات', value: overdue, hint: 'أكثر من 48 ساعة' },
    { label: 'مرتجعات', value: model?.workflowSummary?.returned ?? returns, hint: 'بحاجة إجراء' },
    { label: 'عملاء متابعة', value: followUp, hint: 'لا يوجد نشاط حديث' },
    { label: 'إجمالي الطلبات', value: orders.length, hint: `${customers.length} عميل · ${reps.length} مندوب` },
  ];
}

function svgLineChart(series) {
  const points = Array.isArray(series) ? series : [];
  const width = 440;
  const height = 190;
  const padding = 18;
  const max = Math.max(1, ...points.map((item) => Number(item.value || 0)));
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((item, index) => {
    const x = padding + (step * index);
    const y = height - padding - ((Number(item.value || 0) / max) * (height - padding * 2));
    return { x, y };
  });
  const d = coords.length
    ? `M ${coords.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`
    : '';
  return `
    <svg class="ops-chart__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="opsLineFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-opacity=".32" />
          <stop offset="100%" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${d} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z" fill="url(#opsLineFill)" opacity=".2"></path>
      ${coords.map((point, index) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${index === coords.length - 1 ? 6 : 4}" fill="currentColor"></circle>`).join('')}
    </svg>
  `;
}

function svgDonutChart(buckets) {
  const palette = {
    pending: '#ef4444',
    reviewing: '#f97316',
    preparing: '#f59e0b',
    dispatched: '#22c55e',
    delivered: '#3b82f6',
    returned: '#a855f7',
    cancelled: '#64748b',
  };
  const total = buckets.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  let current = 0;
  const segments = buckets.map((bucket) => {
    const value = Number(bucket.value || 0);
    const fraction = value / total;
    const start = current;
    current += fraction;
    return `${palette[bucket.key] || '#94a3b8'} ${Math.round(start * 360)}deg ${Math.round(current * 360)}deg`;
  });
  const gradient = segments.length ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#1d4ed8 0deg 360deg)';
  return `
    <div class="ops-donut" style="--donut-gradient:${gradient}">
      <div class="ops-donut__ring">
        <strong>${total}</strong>
        <span>إجمالي الحالات</span>
      </div>
    </div>
  `;
}

function metricCard(counter) {
  return `
    <article class="ops-metric-card">
      <span class="ops-metric-card__label">${dom.escape(counter.label)}</span>
      <strong class="ops-metric-card__value">${dom.escape(String(counter.value))}</strong>
      <span class="ops-metric-card__hint">${dom.escape(counter.hint || '')}</span>
    </article>
  `;
}

function queueItem(order, session) {
  const workflow = resolveWorkflowActions(order, session);
  const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
  return `
    <article class="ops-queue-item">
      <div class="ops-queue-item__head">
        <strong>#${dom.escape(String(order.order_number || order.invoice_number || order.id || '—'))}</strong>
        <span class="badge">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</span>
      </div>
      <p>${dom.escape(order.customer_name || order.customer?.name || order.name || 'عميل غير محدد')}</p>
      <div class="ops-queue-item__meta">
        <span class="chip">${dom.escape(formatMoney(Number(order.total_amount || order.total || 0)))} ج.م</span>
        <span class="chip">${dom.escape(String((workflow.executableTransitions || []).length || 0))} إجراء</span>
      </div>
      <div class="ops-queue-item__actions">
        ${next ? `<button class="btn btn--primary" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(next.to_state_key || ''))}">تحويل الحالة</button>` : '<span class="badge">لا توجد حركة</span>'}
        <button class="btn btn--ghost" type="button" data-action="view-invoice" data-invoice-id="${dom.escape(String(order.id || ''))}">عرض</button>
      </div>
    </article>
  `;
}

function renderTopBar(state, model) {
  const session = state?.auth?.session || {};
  const name = text(session.full_name || session.name || session.username || 'العمليات');
  return `
    <header class="ops-topbar">
      <div class="ops-topbar__brand">
        <span class="ops-brand-mark">◈</span>
        <div>
          <strong>لوحة العمليات</strong>
          <small>${dom.escape(model.moduleLabel || 'مركز القيادة')}</small>
        </div>
      </div>
      <label class="ops-topbar__search">
        <span>⌕</span>
        <input type="search" placeholder="ابحث عن طلب، عميل، مندوب، شركة…" />
      </label>
      <div class="ops-topbar__status">
        <span class="ops-topbar__badge">▲</span>
        <div class="ops-topbar__user">
          <strong>${dom.escape(name)}</strong>
          <small>${dom.escape(text(session.user_type || session.userType || 'operational-user'))}</small>
        </div>
      </div>
    </header>
  `;
}

function renderHeroIntro(state, model) {
  const counters = getCounters(state, model);
  const keyMetrics = counters.slice(0, 4);
  return `
    <section class="ops-hero-panel">
      <div class="ops-hero-panel__copy">
        <h1>تصميم داش بورد تشغيلي لنظام إدارة المبيعات والمندوبين</h1>
        <div class="ops-hero-panel__kicker">من صفحة طويلة إلى مركز قيادة حقيقي</div>
        <p>هذه المساحة مبنية كـ Business Operating Console: الوصول سريع، التنفيذ مباشر، والواجهات التشغيلية منفصلة عن المتجر.</p>
        <div class="ops-hero-panel__badge">من صفحة طويلة إلى مركز قيادة حقيقي</div>
        <div class="ops-hero-panel__notes">
          <span>وصول واضح</span>
          <span>أرقام تشغيلية</span>
          <span>رؤية فورية</span>
        </div>
      </div>
      <div class="ops-hero-panel__mock">
        <div class="ops-device-card">
          <div class="ops-device-card__screen">
            <div class="ops-mini-grid">
              ${keyMetrics.map((metric) => `
                <div class="ops-mini-stat">
                  <small>${dom.escape(metric.label)}</small>
                  <strong>${dom.escape(String(metric.value))}</strong>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="ops-phone-card">
          <div class="ops-phone-card__screen">
            <span class="ops-phone-card__dot"></span>
            <span class="ops-phone-card__dot"></span>
            <span class="ops-phone-card__dot"></span>
            <div class="ops-phone-card__badges">
              <span>تنبيهات</span>
              <span>طلبات</span>
              <span>متابعة</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderFeatureRail() {
  const features = [
    ['مركز قيادة حقيقي', 'أرقام مهمة وتنبيهات واضحة في أعلى الصفحة.'],
    ['وصول سريع', 'كل وحدة تشغيلية مفتوحة من اختصار مباشر.'],
    ['إجراءات سريعة', 'بطاقات تنفيذ تضغط أقل وتنجز أسرع.'],
    ['تصميم متجاوب', 'مناسب للشاشات الكبيرة والموبايل بنفس الإيقاع.'],
    ['ألوان دلالية', 'كل حالة لها دلالة بصرية واضحة وسريعة الفهم.'],
    ['قابل للتوسّع', 'سهولة إضافة وحدات وتقارير وتتبّع جديد.'],
  ];
  return `
    <aside class="ops-side-rail">
      <div class="ops-side-rail__head">
        <strong>ميزات التصميم</strong>
        <span class="badge">Executive UI</span>
      </div>
      <div class="ops-side-rail__items">
        ${features.map(([title, body], index) => `
          <article class="ops-feature-card">
            <div class="ops-feature-card__icon">${['◎', '⚡', '↗', '◉', '◍', '▣'][index]}</div>
            <div>
              <strong>${dom.escape(title)}</strong>
              <p>${dom.escape(body)}</p>
            </div>
          </article>
        `).join('')}
      </div>
    </aside>
  `;
}

function renderQuickActions(state) {
  const items = [
    { label: 'إنشاء منتج', module: 'products', icon: '🛒' },
    { label: 'إضافة عميل', module: 'customers', icon: '👤' },
    { label: 'مراجعة الطلبات', module: 'orders', icon: '📋' },
    { label: 'إدارة المستخدمين', module: 'users', icon: '🛡' },
    { label: 'إدارة المناديب', module: 'reps', icon: '👥' },
    { label: 'إدارة الشركات', module: 'companies', icon: '🏢' },
    { label: 'التقارير', module: 'reports', icon: '📊' },
    { label: 'سير العمل', module: 'workflow', icon: '⟲' },
  ];
  return `
    <section class="ops-section-card">
      <div class="ops-section-card__head">
        <h2>إجراءات سريعة</h2>
        <p>اختصار مباشر للوحدات الأكثر استخدامًا</p>
      </div>
      <div class="ops-quick-grid">
        ${items.map((item) => `
          <button class="ops-quick-card" type="button" data-action="go-ops-module" data-module="${dom.escape(item.module)}">
            <span class="ops-quick-card__icon">${dom.escape(item.icon)}</span>
            <strong>${dom.escape(item.label)}</strong>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderAlertsCard(state, model) {
  const orders = getOrders(state);
  const alerts = [
    { title: 'طلبات متأخرة', body: `${orders.filter((order) => ['pending', 'reviewing', 'preparing'].includes(normalizeOrderState(order))).length} طلب`, tone: 'danger' },
    { title: 'نقدًا يتم تحصيله', body: `${orders.filter((order) => normalizeOrderState(order) === 'dispatched').length} طلب`, tone: 'warning' },
    { title: 'عملاء لم تتم متابعتهم', body: `${getCustomers(state).length} عميل`, tone: 'success' },
  ];
  return `
    <section class="ops-section-card">
      <div class="ops-section-card__head">
        <h2>أحدث التنبيهات</h2>
        <p>إشارة تشغيلية مختصرة</p>
      </div>
      <div class="ops-alert-list">
        ${alerts.map((alert) => `
          <article class="ops-alert-card ops-alert-card--${alert.tone}">
            <span class="ops-alert-card__dot"></span>
            <div>
              <strong>${dom.escape(alert.title)}</strong>
              <p>${dom.escape(alert.body)}</p>
            </div>
          </article>
        `).join('')}
      </div>
      <button class="ops-link-button" type="button" data-action="go-ops-module" data-module="orders">عرض كل التنبيهات</button>
    </section>
  `;
}

function renderOrdersTable(state, orders) {
  const session = state?.auth?.session || {};
  const rows = orders.slice(0, 6);
  return `
    <section class="ops-section-card ops-section-card--table">
      <div class="ops-section-card__head">
        <h2>أحدث الطلبات</h2>
        <p>متابعة فورية للحالة والإجراء التالي</p>
      </div>
      <div class="ops-table">
        <div class="ops-table__head">
          <span>#</span><span>العميل</span><span>الحالة</span><span>الإجمالي</span><span>الإجراء</span>
        </div>
        ${rows.map((order) => {
          const workflow = resolveWorkflowActions(order, session);
          const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
          return `
            <div class="ops-table__row">
              <strong>${dom.escape(String(order.order_number || order.invoice_number || order.id || '—'))}</strong>
              <span>${dom.escape(order.customer_name || order.customer?.name || '—')}</span>
              <span><em class="ops-status-pill ops-status-pill--${normalizeOrderState(order)}">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</em></span>
              <span>${dom.escape(formatMoney(Number(order.total_amount || order.total || 0)))} ج.م</span>
              <span>${next ? `<button class="btn btn--primary btn--small" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(next.to_state_key || ''))}">تنفيذ</button>` : '<span class="badge">—</span>'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderWorkflowMatrix(state, orders) {
  const buckets = getStateBuckets(orders);
  const total = orders.length || 1;
  const summary = buckets
    .map((bucket) => `${bucket.key}:${bucket.value}`)
    .join('|');
  const width = 260;
  const segments = buckets.map((bucket) => ({
    ...bucket,
    pct: Math.round((bucket.value / total) * 100),
  }));
  const gradient = `conic-gradient(${segments.map((item) => {
    const palette = {
      pending: 'rgba(255, 91, 91, .9)',
      reviewing: 'rgba(255, 170, 60, .9)',
      preparing: 'rgba(255, 196, 69, .9)',
      dispatched: 'rgba(55, 214, 124, .9)',
      delivered: 'rgba(96, 140, 255, .9)',
      returned: 'rgba(188, 108, 255, .9)',
      cancelled: 'rgba(130, 140, 150, .9)',
    };
    return `${palette[item.key]} ${item.indexStart || 0}deg ${item.indexEnd || 0}deg`;
  }).join(', ')})`;
  return `
    <section class="ops-section-card">
      <div class="ops-section-card__head">
        <h2>حالات الطلبات</h2>
        <p>حسب workflow_state_key</p>
      </div>
      <div class="ops-donut-panel">
        <div class="ops-donut-panel__chart" style="background:${gradient}"><div class="ops-donut-panel__hole"><strong>${orders.length}</strong><span>طلب</span></div></div>
        <div class="ops-donut-panel__legend">
          ${segments.map((bucket) => `<div><span class="ops-legend-dot ops-legend-dot--${bucket.key}"></span><strong>${dom.escape(bucket.label)}</strong><small>${bucket.value}</small></div>`).join('')}
        </div>
      </div>
    </section>
  `;
}

function buildGradientSegments(buckets) {
  const palette = {
    pending: '#ef4444',
    reviewing: '#f97316',
    preparing: '#eab308',
    dispatched: '#22c55e',
    delivered: '#3b82f6',
    returned: '#a855f7',
    cancelled: '#64748b',
  };
  const total = buckets.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  let cursor = 0;
  return buckets.map((bucket) => {
    const value = Number(bucket.value || 0);
    const start = cursor;
    cursor += (value / total) * 360;
    return `${palette[bucket.key] || '#94a3b8'} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
  }).join(', ');
}

function renderCommandCenterHome(state, model) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const reps = getReps(state);
  const companies = getCompanies(state);
  const products = getProducts(state);
  const counters = getCounters(state, model);
  const trend = getTrendSeries(orders, 7);
  const buckets = getStateBuckets(orders);
  const totalGradient = buildGradientSegments(buckets);
  const hotOrders = orders.slice(0, 6);

  return `
    <div class="ops-workspace-shell">
      ${renderTopBar(state, model)}
      <div class="ops-workspace-grid">
        ${renderHeroIntro(state, model)}

        <section class="ops-metrics">
          ${counters.slice(0, 5).map(metricCard).join('')}
        </section>

        <section class="ops-panels-grid">
          <article class="ops-section-card ops-section-card--chart">
            <div class="ops-section-card__head">
              <h2>الطلبات حسب الحالة</h2>
              <p>مؤشر تشغيلي فوري</p>
            </div>
            <div class="ops-chart-layout">
              ${svgDonutChart(buckets)}
              <div class="ops-chart-legend">
                ${buckets.map((bucket) => `
                  <div class="ops-chart-legend__row">
                    <span class="ops-chart-legend__dot ops-chart-legend__dot--${bucket.key}"></span>
                    <strong>${dom.escape(bucket.label)}</strong>
                    <em>${bucket.value}</em>
                  </div>
                `).join('')}
              </div>
            </div>
          </article>

          <article class="ops-section-card ops-section-card--chart">
            <div class="ops-section-card__head">
              <h2>المبيعات (آخر 7 أيام)</h2>
              <p>تتبّع يومي للتدفق</p>
            </div>
            <div class="ops-line-chart">
              <div class="ops-line-chart__value">${dom.escape(formatMoney(orders.reduce((sum, order) => sum + Number(order.total_amount || order.total || 0), 0)))} ج.م</div>
              <div class="ops-line-chart__svg">${svgLineChart(trend)}</div>
              <div class="ops-line-chart__axis">
                ${trend.map((item) => `<span>${dom.escape(item.label)}</span>`).join('')}
              </div>
            </div>
          </article>

          ${renderAlertsCard(state, model)}
        </section>

        ${renderQuickActions(state)}

        <section class="ops-section-card">
          <div class="ops-section-card__head">
            <h2>أسرع الوحدات</h2>
            <p>الانتقال بين المراكز التشغيلية</p>
          </div>
          <div class="ops-module-rail">
            ${HOME_MODULE_KEYS.map((moduleKey) => {
              const module = getOperationalModuleByKey(moduleKey);
              const ready = isOperationalModuleReady(moduleKey);
              return `
                <button class="ops-module-tile ${ready ? 'is-ready' : 'is-locked'}" type="button" data-action="go-ops-module" data-module="${dom.escape(moduleKey)}">
                  <strong>${dom.escape(module?.label || moduleKey)}</strong>
                  <small>${dom.escape(module?.description || '')}</small>
                </button>
              `;
            }).join('')}
          </div>
        </section>

        <section class="ops-panels-grid ops-panels-grid--bottom">
          ${renderOrdersTable(state, hotOrders)}
          <section class="ops-section-card">
            <div class="ops-section-card__head">
              <h2>الفوارق التنفيذية</h2>
              <p>مؤشرات سريعة</p>
            </div>
            <div class="ops-side-stats">
              <div><strong>${customers.length}</strong><span>عملاء</span></div>
              <div><strong>${reps.length}</strong><span>مندوب</span></div>
              <div><strong>${companies.length}</strong><span>شركة</span></div>
              <div><strong>${products.length}</strong><span>منتج</span></div>
            </div>
            <div class="ops-summary-banner">
              <strong>داش بورد مخصص لتشغيل العمل</strong>
              <span>وليس فقط لعرض البيانات</span>
            </div>
          </section>
        </section>

        <section class="ops-bottom-features">
          <div>زيادة سرعة اتخاذ القرار</div>
          <div>تقليل الأخطاء التشغيلية</div>
          <div>تحسين متابعة الطلبات</div>
          <div>رفع كفاءة المندوبين</div>
          <div>نمو المبيعات والأرباح</div>
        </section>
      </div>
      <div class="ops-summary-strip">
        <strong>القيمة النهائية</strong>
        <span>مركز تشغيل حيّ بواجهة تنفيذية سريعة</span>
      </div>
    </div>
  `;
}

function renderSimpleTablePage(title, subtitle, rows, columns, emptyLabel = 'لا توجد بيانات') {
  return `
    <div class="ops-page-wrap">
      <section class="ops-section-card">
        <div class="ops-section-card__head">
          <div>
            <h2>${dom.escape(title)}</h2>
            <p>${dom.escape(subtitle || '')}</p>
          </div>
        </div>
        <div class="ops-table ops-table--management">
          <div class="ops-table__head">
            ${columns.map((column) => `<span>${dom.escape(column)}</span>`).join('')}
          </div>
          ${rows.length ? rows.join('') : `<div class="ops-table__empty">${dom.escape(emptyLabel)}</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderCustomersModule(state) {
  const customers = getCustomers(state);
  const rows = customers.map((customer) => `
    <div class="ops-table__row">
      <strong>${dom.escape(customer.full_name || customer.name || '—')}</strong>
      <span>${dom.escape(customer.phone || '—')}</span>
      <span>${dom.escape(customer.user_type || customer.customer_type || 'direct')}</span>
      <span>${dom.escape(customer.owner_name || customer.sales_rep_name || '—')}</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="open-customer-modal">تعديل</button>
        <button class="btn btn--ghost btn--small" type="button" data-action="open-customer-modal">حفظ</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة العملاء', 'عملاء مباشرون ومُدارون مع تحكم بالملكية والمتابعة', rows, ['الاسم', 'الهاتف', 'النوع', 'المالك', 'الإجراءات'], 'لا توجد عملاء');
}

function renderProductsModule(state) {
  const products = getProducts(state);
  const rows = products.map((product) => `
    <div class="ops-table__row">
      <strong>${dom.escape(product.product_name || '—')}</strong>
      <span>${dom.escape(product.company_name || '—')}</span>
      <span>${dom.escape(product.category || '—')}</span>
      <span>${dom.escape(product.visible === false ? 'مخفي' : 'ظاهر')}</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="open-product" data-product-id="${dom.escape(product.product_id)}">عرض</button>
        <button class="btn btn--ghost btn--small" type="button" data-action="open-product" data-product-id="${dom.escape(product.product_id)}">تعديل</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة المنتجات', 'منتجات وأسعار وظهور وربط بالشركات', rows, ['المنتج', 'الشركة', 'الفئة', 'الحالة', 'الإجراءات'], 'لا توجد منتجات');
}

function renderCompaniesModule(state) {
  const companies = getCompanies(state);
  const rows = companies.map((company) => `
    <div class="ops-table__row">
      <strong>${dom.escape(company.company_name || '—')}</strong>
      <span>${dom.escape(company.company_id || '—')}</span>
      <span>${dom.escape(company.visible === false ? 'مخفية' : 'ظاهرة')}</span>
      <span>${dom.escape(text(company.allow_discount === false ? 'بدون خصم' : 'خصم متاح'))}</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="go-ops-module" data-module="companies">تعديل</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة الشركات', 'التحكم في شركات التوريد والظهور', rows, ['الاسم', 'المعرف', 'الظهور', 'السياسة', 'الإجراءات'], 'لا توجد شركات');
}

function renderRepsModule(state) {
  const reps = getReps(state);
  const rows = reps.map((rep) => `
    <div class="ops-table__row">
      <strong>${dom.escape(rep.full_name || rep.username || '—')}</strong>
      <span>${dom.escape(rep.phone || '—')}</span>
      <span>${dom.escape(rep.user_type || 'rep')}</span>
      <span>${dom.escape(rep.is_blocked ? 'محظور' : rep.is_active === false ? 'غير نشط' : 'نشط')}</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="go-ops-module" data-module="sales-manager">إدارة</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة المناديب', 'متابعة الأداء وربط العملاء والصلاحيات', rows, ['الاسم', 'الهاتف', 'النوع', 'الحالة', 'الإجراءات'], 'لا يوجد مناديب');
}

function renderUsersModule(state) {
  const users = getSystemUsers(state);
  const rows = users.map((user) => `
    <div class="ops-table__row">
      <strong>${dom.escape(user.full_name || user.username || '—')}</strong>
      <span>${dom.escape(user.phone || '—')}</span>
      <span>${dom.escape(user.user_type || 'system_user')}</span>
      <span>${dom.escape(user.is_blocked ? 'محظور' : user.is_active === false ? 'متوقف' : 'نشط')}</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="go-ops-module" data-module="users">صلاحيات</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة المستخدمين', 'سجلات النظام والصلاحيات التشغيلية', rows, ['الاسم', 'الهاتف', 'النوع', 'الحالة', 'الإجراءات'], 'لا يوجد مستخدمون');
}

function renderCategoriesModule(state) {
  const categories = getCategories(state);
  const rows = categories.map((category) => `
    <div class="ops-table__row">
      <strong>${dom.escape(category.name || '—')}</strong>
      <span>${dom.escape(String(category.products || 0))}</span>
      <span>${dom.escape(category.visible ? 'ظاهر' : 'مخفي')}</span>
      <span>—</span>
      <span class="ops-row-actions">
        <button class="btn btn--ghost btn--small" type="button" data-action="go-ops-module" data-module="products">تحكم</button>
      </span>
    </div>
  `);
  return renderSimpleTablePage('إدارة التصنيفات', 'إنشاء وتعديل وحجب التصنيفات', rows, ['التصنيف', 'المنتجات', 'الحالة', '—', 'الإجراءات'], 'لا توجد تصنيفات');
}

function renderOrdersModule(state) {
  const orders = getOrders(state);
  const session = state.auth.session;
  const counters = getCounters(state, createOpsDashboardModel(state));
  return `
    <div class="ops-page-wrap">
      <section class="ops-section-card">
        <div class="ops-section-card__head">
          <div>
            <h2>إدارة الطلبات</h2>
            <p>طوابير التنفيذ والتحويل السريع للحالات</p>
          </div>
          <span class="badge">${dom.escape(String(orders.length))} طلب</span>
        </div>
        <div class="ops-metrics" style="margin-bottom:14px">${counters.slice(0, 4).map(metricCard).join('')}</div>
        <div class="ops-table">
          <div class="ops-table__head"><span>#</span><span>العميل</span><span>الحالة</span><span>الإجمالي</span><span>الإجراء</span></div>
          ${orders.slice(0, 10).map((order) => {
            const workflow = resolveWorkflowActions(order, session);
            const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
            return `
              <div class="ops-table__row">
                <strong>${dom.escape(String(order.order_number || order.invoice_number || order.id || '—'))}</strong>
                <span>${dom.escape(order.customer_name || order.customer?.name || '—')}</span>
                <span>${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</span>
                <span>${dom.escape(formatMoney(Number(order.total_amount || order.total || 0)))} ج.م</span>
                <span class="ops-row-actions">
                  ${next ? `<button class="btn btn--primary btn--small" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(next.to_state_key || ''))}">${dom.escape(next.to_state_label || 'تنفيذ')}</button>` : '<span class="badge">—</span>'}
                  <button class="btn btn--ghost btn--small" type="button" data-action="view-invoice" data-invoice-id="${dom.escape(String(order.id || ''))}">عرض</button>
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderReportsModule(state) {
  const orders = getOrders(state);
  const total = orders.reduce((sum, order) => sum + safeNumber(order.total_amount || order.total || 0), 0);
  const recent = orders.slice(0, 5);
  return `
    <div class="ops-page-wrap">
      <section class="ops-section-card">
        <div class="ops-section-card__head">
          <div>
            <h2>التقارير</h2>
            <p>قراءات تشغيلية سريعة مبنية على البيانات المتاحة</p>
          </div>
        </div>
        <div class="ops-report-grid">
          <article><strong>${orders.length}</strong><span>إجمالي الطلبات</span></article>
          <article><strong>${formatMoney(total)}</strong><span>إجمالي المبيعات</span></article>
          <article><strong>${getCustomers(state).length}</strong><span>العملاء</span></article>
          <article><strong>${getReps(state).length}</strong><span>المناديب</span></article>
        </div>
        <div class="ops-table">
          <div class="ops-table__head"><span>#</span><span>العميل</span><span>الحالة</span><span>الإجمالي</span><span>التاريخ</span></div>
          ${recent.map((order) => `
            <div class="ops-table__row">
              <strong>${dom.escape(String(order.order_number || order.id || '—'))}</strong>
              <span>${dom.escape(order.customer_name || order.customer?.name || '—')}</span>
              <span>${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</span>
              <span>${dom.escape(formatMoney(Number(order.total_amount || order.total || 0)))} ج.م</span>
              <span>${dom.escape(formatDate(order.created_at || order.updated_at || order.order_date))}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderWorkflowModule(state) {
  const orders = getOrders(state);
  const session = state.auth.session;
  return `
    <div class="ops-page-wrap">
      <section class="ops-section-card">
        <div class="ops-section-card__head">
          <div>
            <h2>سير العمل</h2>
            <p>حالات تشغيلية قابلة للتنفيذ</p>
          </div>
        </div>
        <div class="ops-workflow-list">
          ${orders.slice(0, 8).map((order) => {
            const workflow = resolveWorkflowActions(order, session);
            return `
              <article class="ops-workflow-card">
                <div>
                  <strong>#${dom.escape(String(order.order_number || order.id || '—'))}</strong>
                  <p>${dom.escape(order.customer_name || order.customer?.name || '—')}</p>
                </div>
                <span class="badge">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</span>
                <div class="ops-workflow-card__actions">
                  ${(workflow.executableTransitions || []).map((transition) => `
                    <button class="btn btn--ghost btn--small" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(transition.to_state_key || ''))}">
                      ${dom.escape(transition.to_state_label || 'تحويل')}
                    </button>
                  `).join('') || '<span class="badge">لا توجد انتقالات</span>'}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderModulePage(state, model) {
  const moduleKey = String(state?.app?.route?.params?.module || model.moduleKey || 'sales-manager').trim();
  if (moduleKey === 'sales-manager' || moduleKey === 'sales') return renderCommandCenterHome(state, model);
  if (moduleKey === 'orders') return renderOrdersModule(state);
  if (moduleKey === 'customers') return renderCustomersModule(state);
  if (moduleKey === 'products' || moduleKey === 'catalog') return renderProductsModule(state);
  if (moduleKey === 'categories') return renderCategoriesModule(state);
  if (moduleKey === 'companies') return renderCompaniesModule(state);
  if (moduleKey === 'users') return renderUsersModule(state);
  if (moduleKey === 'reps') return renderRepsModule(state);
  if (moduleKey === 'reports') return renderReportsModule(state);
  if (moduleKey === 'workflow') return renderWorkflowModule(state);
  return renderCommandCenterHome(state, model);
}

export function renderOpsDashboardPage(state) {
  const model = createOpsDashboardModel(state);

  if (!model.canOpen) {
    return `
      <div class="ops-page-wrap">
        <section class="ops-section-card">
          <div class="ops-section-card__head">
            <div>
              <h2>مركز التشغيل</h2>
              <p>هذه المساحة مخصصة للحسابات التشغيلية المصرح لها</p>
            </div>
          </div>
          <div class="ops-empty-state">لا توجد صلاحية تشغيلية كافية لفتح هذه المساحة.</div>
        </section>
      </div>
    `;
  }

  return renderModulePage(state, model);
}
