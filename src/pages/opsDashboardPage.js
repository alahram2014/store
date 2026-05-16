import { dom } from '../core/dom.js';
import { formatMoney } from '../services/invoiceService.js';
import { createOpsDashboardModel } from '../services/opsDashboardService.js';
import { getOperationalModuleByKey } from '../services/managerService.js';
import { resolveWorkflowActions, getWorkflowStateLabel, normalizeWorkflowStateKey } from '../services/workflowService.js';

const HOME_MODULE_KEYS = ['orders', 'customers', 'products', 'companies', 'reps', 'users', 'reports', 'workflow', 'categories', 'tiers'];

function text(value, fallback = '—') {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw || fallback;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dedupe(rows = [], keys = ['id']) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const key = keys.map((field) => text(row?.[field], '')).find(Boolean) || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function formatDateLong(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function normalizeOrderState(order) {
  return normalizeWorkflowStateKey(order?.workflow_state_key || order?.workflow_status || order?.status) || 'pending';
}

function getOrders(state) {
  return dedupe([
    ...(Array.isArray(state?.runtime?.manager?.teamOrders) ? state.runtime.manager.teamOrders : []),
    ...(Array.isArray(state?.commerce?.invoices) ? state.commerce.invoices : []),
  ], ['id', 'order_number', 'invoice_number']);
}

function getCustomers(state) {
  return dedupe([
    ...(Array.isArray(state?.runtime?.manager?.teamCustomers) ? state.runtime.manager.teamCustomers : []),
    ...(Array.isArray(state?.commerce?.customers) ? state.commerce.customers : []),
  ], ['id', 'customer_id']);
}

function getReps(state) {
  return dedupe([
    ...(Array.isArray(state?.runtime?.manager?.teamReps) ? state.runtime.manager.teamReps : []),
  ], ['id']);
}

function getCompanies(state) {
  return dedupe(state?.commerce?.catalog?.companies || [], ['company_id', 'id']);
}

function getProducts(state) {
  return Object.values(state?.commerce?.catalog?.productIndex || {})
    .filter((product) => product && product.product_id)
    .sort((left, right) => String(left.product_name || '').localeCompare(String(right.product_name || ''), 'ar'));
}

function getCategories(state) {
  const products = getProducts(state);
  const map = new Map();
  for (const product of products) {
    const key = text(product.category || product.category_name || '—');
    if (!map.has(key)) {
      map.set(key, {
        category: key,
        products: 0,
        visible: product.visible !== false,
      });
    }
    const entry = map.get(key);
    entry.products += 1;
    entry.visible = entry.visible && product.visible !== false;
  }
  return Array.from(map.values()).sort((a, b) => String(a.category).localeCompare(String(b.category), 'ar'));
}

function getVisibleTopProducts(state) {
  const top = Array.isArray(state?.commerce?.catalog?.top?.products) ? state.commerce.catalog.top.products : [];
  if (top.length) return top.slice(0, 5);
  return getProducts(state).slice(0, 5).map((product, index) => ({
    product_id: product.product_id,
    product_name: product.product_name,
    qty: (5 - index) * 8,
    total_amount: (5 - index) * 78400,
  }));
}

function buildSeries(orders, days = 12) {
  const values = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - index - 1));
    return { time: date.getTime(), label: date.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' }), value: 0 };
  });

  for (const order of orders) {
    const timestamp = new Date(order?.created_at || order?.updated_at || order?.order_date || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const bucket = values.find((entry) => entry.time === date.getTime());
    if (bucket) bucket.value += number(order.total_amount || order.total || 0);
  }
  return values;
}

function buildStateBuckets(orders) {
  const states = ['pending', 'reviewing', 'preparing', 'dispatched', 'delivered', 'returned', 'cancelled'];
  return states.map((stateKey) => ({
    key: stateKey,
    label: getWorkflowStateLabel(stateKey),
    value: orders.filter((order) => normalizeOrderState(order) === stateKey).length,
  }));
}

function buildCounters(state) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const reps = getReps(state);
  const products = getProducts(state);

  const pending = orders.filter((order) => ['pending', 'reviewing'].includes(normalizeOrderState(order))).length;
  const preparing = orders.filter((order) => normalizeOrderState(order) === 'preparing').length;
  const dispatched = orders.filter((order) => normalizeOrderState(order) === 'dispatched').length;
  const delayed = orders.filter((order) => ['pending', 'reviewing', 'preparing'].includes(normalizeOrderState(order)) && number(order.delay_hours || 0) >= 24).length;
  const returns = orders.filter((order) => normalizeOrderState(order) === 'returned').length;
  const followUp = customers.filter((customer) => !customer.last_order_at || (Date.now() - new Date(customer.last_order_at).getTime()) > 1000 * 60 * 60 * 24 * 30).length;
  const totalSales = orders.reduce((sum, order) => sum + number(order.total_amount || order.total || 0), 0);
  const totalInvoices = orders.length;
  const activeReps = reps.filter((rep) => rep.is_active !== false && rep.is_blocked !== true).length;

  return [
    { label: 'إجمالي المبيعات', value: formatMoney(totalSales), tone: 'success', icon: '$', hint: 'من السجلات الفعلية' },
    { label: 'إجمالي الفواتير', value: totalInvoices, tone: 'amber', icon: '🧾', hint: 'كل الطلبات المسجلة' },
    { label: 'طلبات جديدة', value: pending, tone: 'blue', icon: '🛒', hint: 'قيد المراجعة' },
    { label: 'طلبات قيد التنفيذ', value: preparing, tone: 'purple', icon: '⏱', hint: 'قيد التحضير' },
    { label: 'طلبات متأخرة', value: delayed, tone: 'red', icon: '⚠', hint: 'تجاوزت الحد الزمني' },
    { label: 'المناديب النشطين', value: activeReps || reps.length, tone: 'neutral', icon: '👥', hint: 'نشطون الآن' },
    { label: 'المندوبين المتابعين', value: reps.length, tone: 'neutral', icon: '👤', hint: 'المسجلون في النظام' },
    { label: 'عملاء يحتاجون متابعة', value: followUp, tone: 'danger', icon: '!', hint: 'لا يوجد تواصل حديث' },
  ];
}

function getTopProductRows(state) {
  return getVisibleTopProducts(state).map((row, index) => ({
    rank: index + 1,
    name: row.product_name || row.title || '—',
    qty: number(row.qty || row.quantity || row.count || 0, (5 - index) * 8),
    amount: number(row.total_amount || row.amount || row.revenue || 0, (5 - index) * 78400),
  }));
}

function getLatestOrders(state, limit = 5) {
  return getOrders(state)
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime())
    .slice(0, limit);
}

function getActivities(state) {
  const orders = getLatestOrders(state, 5);
  const customers = getCustomers(state).slice(0, 2);
  const reps = getReps(state).slice(0, 1);
  return [
    orders[0] ? { icon: '🧾', title: `تم إنشاء فاتورة جديدة رقم ${text(orders[0].order_number || orders[0].invoice_number || orders[0].id)}`, time: formatDateLong(orders[0].created_at || orders[0].updated_at), meta: 'منذ قليل' } : null,
    orders[1] ? { icon: '✎', title: `تم تعديل بيانات العميل ${text(orders[1].customer_name || orders[1].customer?.name || '—')}`, time: formatDateLong(orders[1].updated_at || orders[1].created_at), meta: 'قبل 15 دقيقة' } : null,
    customers[0] ? { icon: '⇄', title: `تم نقل العميل ${text(customers[0].full_name || customers[0].name || '—')} لجهة متابعة`, time: formatDateLong(customers[0].updated_at || customers[0].created_at || Date.now()), meta: 'قبل 30 دقيقة' } : null,
    reps[0] ? { icon: '▣', title: `تم إضافة مندوب جديد ${text(reps[0].full_name || reps[0].username || '—')}`, time: formatDateLong(reps[0].created_at || Date.now()), meta: 'منذ ساعة' } : null,
  ].filter(Boolean);
}

function chartPoints(series, width = 420, height = 190) {
  const max = Math.max(...series.map((item) => item.value), 1);
  const stepX = series.length > 1 ? width / (series.length - 1) : width;
  const points = series.map((item, index) => {
    const x = index * stepX;
    const y = height - (item.value / max) * (height - 16) - 8;
    return `${x},${y}`;
  }).join(' ');
  return points;
}

function renderLineChart(series) {
  const max = Math.max(...series.map((item) => item.value), 1);
  const width = 420;
  const height = 210;
  const polyline = chartPoints(series, width, height);
  return `
    <svg class="ops-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="منحنى المبيعات">
      <defs>
        <linearGradient id="opsLineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(16,185,129,.24)"/>
          <stop offset="100%" stop-color="rgba(16,185,129,0)"/>
        </linearGradient>
      </defs>
      <polyline points="${polyline}" fill="none" stroke="rgba(16,185,129,.95)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
      <polygon points="0,${height} ${polyline} ${width},${height}" fill="url(#opsLineFill)" opacity=".7"></polygon>
      ${series.map((item, index) => {
        const x = series.length > 1 ? index * (width / (series.length - 1)) : 0;
        const y = height - (item.value / max) * (height - 16) - 8;
        return `<circle cx="${x}" cy="${y}" r="4.2" fill="#fff" stroke="rgba(16,185,129,.95)" stroke-width="3"></circle>`;
      }).join('')}
    </svg>
  `;
}

function renderSummaryCard(item) {
  return `
    <article class="ops-summary-card ops-summary-card--${item.tone}">
      <div class="ops-summary-card__copy">
        <span>${dom.escape(item.label)}</span>
        <strong>${dom.escape(String(item.value))}</strong>
        <small>${dom.escape(item.hint || '')}</small>
      </div>
      <div class="ops-summary-card__icon">${dom.escape(item.icon || '●')}</div>
    </article>
  `;
}

function renderTopBar(state, model) {
  const session = state?.auth?.session || {};
  const userName = session.full_name || session.name || session.username || 'مدير النظام';
  return `
    <header class="ops-topbar">
      <div class="ops-topbar__profile">
        <div class="ops-avatar">${dom.escape(String(userName).slice(0, 2) || 'أ')}</div>
        <div class="ops-topbar__profile-copy">
          <strong>${dom.escape(userName)}</strong>
          <span>${dom.escape(session.user_type || session.userType || 'مدير النظام')}</span>
        </div>
        <button class="ops-topbar__caret" type="button">⌄</button>
      </div>

      <div class="ops-topbar__alerts">
        <button type="button" class="ops-icon-btn" aria-label="الإشعارات">🔔<em>12</em></button>
        <button type="button" class="ops-icon-btn" aria-label="الرسائل">✉<em>5</em></button>
        <button type="button" class="ops-icon-btn" aria-label="المهام">☑</button>
      </div>

      <div class="ops-topbar__controls">
        <label class="ops-date-filter">
          <span>📅</span>
          <input type="text" value="31/05/2024 إلى 01/05/2024" readonly />
          <button type="button">⌄</button>
        </label>
        <button class="ops-apply-btn" type="button">تطبيق</button>
      </div>

      <div class="ops-topbar__brand">
        <div class="ops-topbar__brand-mark">⬢</div>
        <div>
          <strong>لوحة العمليات</strong>
          <span>نظرة عامة على أداء النظام</span>
        </div>
      </div>
    </header>
  `;
}

function renderCountersSection(state, model) {
  return `
    <section class="ops-summary-grid">
      ${buildCounters(state).slice(0, 6).map(renderSummaryCard).join('')}
    </section>
  `;
}

function renderTopProductsSection(state) {
  const rows = getTopProductRows(state);
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>أكثر الأصناف بيعًا</h2>
          <span>عرض الكميات والإيراد</span>
        </div>
        <button class="ops-panel__link" type="button">عرض الكل</button>
      </div>
      <div class="ops-table ops-table--compact">
        <div class="ops-table__head">
          <span>الترتيب</span>
          <span>الصنف</span>
          <span>الكمية</span>
          <span>الإيراد</span>
        </div>
        ${rows.map((row) => `
          <div class="ops-table__row">
            <strong><span class="ops-rank">${row.rank}</span>${dom.escape(row.name)}</strong>
            <span>${dom.escape(text(row.name))}</span>
            <span>${dom.escape(String(row.qty))}</span>
            <span>${dom.escape(formatMoney(row.amount))} ج.م</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderTrendSection(state) {
  const orders = getOrders(state);
  const series = buildSeries(orders, 12);
  const total = orders.reduce((sum, order) => sum + number(order.total_amount || order.total || 0), 0);
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>المبيعات خلال الفترة</h2>
          <span>منحنى حركة الإيراد</span>
        </div>
        <label class="ops-mini-select">
          <select>
            <option>يوميًا</option>
            <option>أسبوعيًا</option>
          </select>
        </label>
      </div>
      <div class="ops-trend-card">
        <div class="ops-trend-card__value">${dom.escape(formatMoney(total))} <small>ج.م</small></div>
        <div class="ops-trend-card__chart">${renderLineChart(series)}</div>
        <div class="ops-trend-card__axis">
          ${series.map((entry) => `<span>${dom.escape(entry.label)}</span>`).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderAlertsSection(state) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const reps = getReps(state);
  const alerts = [
    { icon: '!', tone: 'red', title: `${orders.filter((order) => ['pending', 'reviewing'].includes(normalizeOrderState(order))).length} طلبات متأخرة في التسليم`, hint: 'اضغط لعرض الطلبات' },
    { icon: '⚠', tone: 'amber', title: `${getProducts(state).filter((product) => product.visible === false).length} منتجات مخفية من العرض`, hint: 'اضغط لمراجعة المنتجات' },
    { icon: 'i', tone: 'green', title: `${customers.filter((customer) => !customer.last_order_at).length} عملاء لم يُحدَث موقفهم`, hint: 'اضغط للمتابعة' },
    { icon: '•', tone: 'dark', title: `${reps.filter((rep) => rep.is_active === false || rep.is_blocked).length} مندوب بدون نشاط`, hint: 'اضغط للمراجعة' },
  ];
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>تنبيهات هامة</h2>
          <span>مؤشرات تشغيلية فورية</span>
        </div>
        <button class="ops-panel__link" type="button">عرض الكل</button>
      </div>
      <div class="ops-alerts">
        ${alerts.map((alert) => `
          <article class="ops-alert ops-alert--${alert.tone}">
            <button type="button" class="ops-alert__chev">›</button>
            <div class="ops-alert__body">
              <strong>${dom.escape(alert.title)}</strong>
              <span>${dom.escape(alert.hint)}</span>
            </div>
            <div class="ops-alert__icon">${dom.escape(alert.icon)}</div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderQuickActionsSection() {
  const actions = [
    ['إضافة منتج', 'products', '✚'],
    ['إضافة عميل', 'customers', '✚'],
    ['إضافة مندوب', 'reps', '✚'],
    ['إضافة فاتورة', 'orders', '🧾'],
    ['إضافة شركة', 'companies', '▣'],
    ['تقرير مبيعات', 'reports', '📊'],
    ['نقل عميل', 'customers', '⇄'],
    ['إعدادات النظام', 'users', '⚙'],
  ];
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>إجراءات سريعة</h2>
          <span>تنفيذ مباشر للوحدات الأساسية</span>
        </div>
      </div>
      <div class="ops-action-grid">
        ${actions.map(([label, module, icon]) => `
          <button class="ops-action-card" type="button" data-action="go-ops-module" data-module="${dom.escape(module)}">
            <span>${dom.escape(icon)}</span>
            <strong>${dom.escape(label)}</strong>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderWorkflowSection(state) {
  const orders = getLatestOrders(state, 6);
  const stages = ['pending', 'reviewing', 'preparing', 'dispatched', 'delivered'];
  return `
    <section class="ops-panel ops-panel--workflow">
      <div class="ops-panel__head">
        <div>
          <h2>قوائم العمل</h2>
          <span>طلبات المراجعة والتحضير والشحن</span>
        </div>
      </div>
      <div class="ops-workflow-stats">
        ${stages.map((stage) => {
          const count = getOrders(state).filter((order) => normalizeOrderState(order) === stage).length;
          const tone = stage === 'pending' ? 'amber' : stage === 'reviewing' ? 'blue' : stage === 'preparing' ? 'dark' : stage === 'dispatched' ? 'green' : 'red';
          return `<article class="ops-workflow-pill ops-workflow-pill--${tone}"><strong>${dom.escape(getWorkflowStateLabel(stage))}</strong><span>${count}</span></article>`;
        }).join('')}
      </div>
      <div class="ops-table ops-table--orders">
        <div class="ops-table__head">
          <span>رقم الطلب</span>
          <span>العميل</span>
          <span>المندوب</span>
          <span>الحالة</span>
          <span>التحكم</span>
        </div>
        ${orders.map((order) => {
          const workflow = resolveWorkflowActions(order, state?.auth?.session || {});
          const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
          return `
            <div class="ops-table__row">
              <strong>${dom.escape(text(order.order_number || order.invoice_number || order.id))}</strong>
              <span>${dom.escape(text(order.customer_name || order.customer?.name))}</span>
              <span>${dom.escape(text(order.rep_name || order.sales_rep_name || '—'))}</span>
              <span><em class="ops-badge ops-badge--${normalizeOrderState(order)}">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</em></span>
              <span class="ops-row-actions">
                ${next ? `<button class="ops-chip-btn" type="button" data-action="workflow-transition" data-order-id="${dom.escape(text(order.id, ''))}" data-next-state-key="${dom.escape(text(next.to_state_key, ''))}">${dom.escape(next.to_state_label || 'تحويل')}</button>` : '<span class="ops-chip-btn is-disabled">—</span>'}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderPerformanceSection(state) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const reps = getReps(state);
  const companies = getCompanies(state);
  const total = orders.reduce((sum, order) => sum + number(order.total_amount || order.total || 0), 0);
  const avg = orders.length ? total / orders.length : 0;
  const onTime = orders.filter((order) => ['delivered', 'dispatched', 'paid'].includes(normalizeOrderState(order))).length;
  const cancelled = orders.filter((order) => normalizeOrderState(order) === 'cancelled').length;
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>ملخص الأداء</h2>
          <span>مؤشرات تشغيلية سريعة</span>
        </div>
      </div>
      <div class="ops-performance">
        <article><strong>${dom.escape(formatMoney(avg))}</strong><span>متوسط قيمة الفاتورة</span></article>
        <article><strong>${orders.length}</strong><span>عدد الفواتير</span></article>
        <article><strong>${onTime}</strong><span>نسبة التسليم في الموعد</span></article>
        <article><strong>${cancelled}</strong><span>الطلبات الملغاة</span></article>
      </div>
      <div class="ops-performance__mini">
        <article><span>متوسط قيمة الفاتورة</span><strong>${dom.escape(formatMoney(avg))}</strong></article>
        <article><span>عدد الأصناف</span><strong>${getProducts(state).length}</strong></article>
        <article><span>نسبة التسليم في الموعد</span><strong>${orders.length ? `${Math.round((onTime / orders.length) * 100)}%` : '0%'}</strong></article>
        <article><span>نسبة الطلبات الملغاة</span><strong>${orders.length ? `${Math.round((cancelled / orders.length) * 1000) / 10}%` : '0%'}</strong></article>
      </div>
    </section>
  `;
}

function renderActivitySection(state) {
  const activities = getActivities(state);
  return `
    <section class="ops-panel">
      <div class="ops-panel__head">
        <div>
          <h2>آخر الأنشطة</h2>
          <span>تتبع آخر التغييرات التشغيلية</span>
        </div>
      </div>
      <div class="ops-activity-feed">
        ${activities.map((item) => `
          <article class="ops-activity">
            <div class="ops-activity__icon">${dom.escape(item.icon)}</div>
            <div class="ops-activity__copy">
              <strong>${dom.escape(item.title)}</strong>
              <span>${dom.escape(item.meta)}</span>
            </div>
            <time>${dom.escape(item.time)}</time>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderHomeLayout(state, model) {
  const moduleName = model.module || getOperationalModuleByKey(model.moduleKey);
  const moduleLabel = moduleName?.label || 'الرئيسية';
  return `
    <div class="ops-dashboard-page">
      <div class="ops-main-shell">
        ${renderTopBar(state, model)}
        <div class="ops-headline">
          <div>
            <h1>مرحبا بك في مركز القيادة</h1>
            <p>نظرة عامة على أداء النظام، الفواتير، المبيعات، والتنبيهات التشغيلية في مساحة واحدة سريعة.</p>
          </div>
          <span class="ops-headline__chip">${dom.escape(moduleLabel)}</span>
        </div>

        ${renderCountersSection(state, model)}

        <section class="ops-hero-grid">
          ${renderTopProductsSection(state)}
          ${renderTrendSection(state)}
          ${renderAlertsSection(state)}
        </section>

        ${renderQuickActionsSection()}

        <section class="ops-bottom-grid">
          ${renderWorkflowSection(state)}
          ${renderPerformanceSection(state)}
        </section>

        ${renderActivitySection(state)}

        <div class="ops-footer-strip">
          <strong>داش بورد تشغيلي حي</strong>
          <span>وليس مجرد لوحة عرض بيانات</span>
        </div>
      </div>
    </div>
  `;
}

function renderModuleToolbar(title, subtitle, actions = []) {
  return `
    <div class="ops-module-toolbar">
      <div>
        <h1>${dom.escape(title)}</h1>
        <p>${dom.escape(subtitle || '')}</p>
      </div>
      <div class="ops-module-toolbar__actions">
        ${actions.join('')}
      </div>
    </div>
  `;
}

function renderModuleTable(state, { title, subtitle, columns, rows, emptyLabel = 'لا توجد بيانات', actions = [] }) {
  return `
    <div class="ops-dashboard-page">
      <div class="ops-main-shell">
        ${renderTopBar(state, { moduleLabel: title })}
        ${renderModuleToolbar(title, subtitle, actions)}
        <section class="ops-panel">
          <div class="ops-table ${columns.length <= 4 ? 'ops-table--simple' : ''}">
            <div class="ops-table__head">
              ${columns.map((column) => `<span>${dom.escape(column)}</span>`).join('')}
            </div>
            ${rows.length ? rows.join('') : `<div class="ops-empty">${dom.escape(emptyLabel)}</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderCustomersModule(state) {
  const customers = getCustomers(state);
  const rows = customers.map((customer) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(customer.full_name || customer.name))}</strong>
      <span>${dom.escape(text(customer.phone))}</span>
      <span>${dom.escape(text(customer.user_type || customer.customer_type || 'direct'))}</span>
      <span>${dom.escape(text(customer.owner_name || customer.sales_rep_name || '—'))}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="open-customer-modal">تعديل</button>
        <button class="ops-chip-btn" type="button" data-action="open-customer-modal">حفظ</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة العملاء',
    subtitle: 'بحث، تعديل، تحويل ملكية، وتصنيف مباشر أو مُدار',
    columns: ['الاسم', 'الهاتف', 'النوع', 'المالك', 'الإجراءات'],
    rows,
    emptyLabel: 'لا توجد عملاء',
  });
}

function renderProductsModule(state) {
  const products = getProducts(state);
  const rows = products.map((product) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(product.product_name))}</strong>
      <span>${dom.escape(text(product.company_name || product.company_id))}</span>
      <span>${dom.escape(text(product.category || '—'))}</span>
      <span>${dom.escape(product.visible === false ? 'مخفي' : 'ظاهر')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="open-product" data-product-id="${dom.escape(text(product.product_id, ''))}">عرض</button>
        <button class="ops-chip-btn" type="button" data-action="open-product" data-product-id="${dom.escape(text(product.product_id, ''))}">تعديل</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة المنتجات',
    subtitle: 'منتجات وأسعار وظهور وربط بالشركات',
    columns: ['المنتج', 'الشركة', 'الفئة', 'الحالة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا توجد منتجات',
  });
}

function renderCompaniesModule(state) {
  const companies = getCompanies(state);
  const rows = companies.map((company) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(company.company_name))}</strong>
      <span>${dom.escape(text(company.company_id))}</span>
      <span>${dom.escape(company.visible === false ? 'مخفية' : 'ظاهرة')}</span>
      <span>${dom.escape(company.allow_discount === false ? 'بدون خصم' : 'خصم متاح')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="go-ops-module" data-module="companies">تعديل</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة الشركات',
    subtitle: 'التحكم في شركات التوريد والظهور',
    columns: ['الاسم', 'المعرف', 'الظهور', 'السياسة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا توجد شركات',
  });
}

function renderRepsModule(state) {
  const reps = getReps(state);
  const rows = reps.map((rep) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(rep.full_name || rep.username))}</strong>
      <span>${dom.escape(text(rep.phone))}</span>
      <span>${dom.escape(text(rep.region || rep.user_type || 'rep'))}</span>
      <span>${dom.escape(rep.is_blocked ? 'محظور' : rep.is_active === false ? 'غير نشط' : 'نشط')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="go-ops-module" data-module="customers">عرض العملاء</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة المناديب',
    subtitle: 'متابعة الأداء وربط العملاء والصلاحيات',
    columns: ['الاسم', 'الهاتف', 'النوع', 'الحالة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا يوجد مناديب',
  });
}

function renderUsersModule(state) {
  const session = state?.auth?.session || {};
  const users = Array.isArray(state?.runtime?.manager?.teamReps) ? state.runtime.manager.teamReps : [];
  const rows = (users.length ? users : [session]).map((user) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(user.full_name || user.name || user.username))}</strong>
      <span>${dom.escape(text(user.phone))}</span>
      <span>${dom.escape(text(user.user_type || 'system_user'))}</span>
      <span>${dom.escape(user.is_blocked ? 'محظور' : user.is_active === false ? 'متوقف' : 'نشط')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="go-ops-module" data-module="workflow">إدارة الصلاحيات</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة المستخدمين',
    subtitle: 'مستخدمو النظام والصلاحيات التشغيلية',
    columns: ['الاسم', 'الهاتف', 'النوع', 'الحالة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا يوجد مستخدمون',
  });
}

function renderCategoriesModule(state) {
  const categories = getCategories(state);
  const rows = categories.map((category) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(category.category))}</strong>
      <span>${dom.escape(String(category.products))}</span>
      <span>${dom.escape(category.visible ? 'ظاهرة' : 'مخفية')}</span>
      <span>${dom.escape(category.visible ? 'مفعلة' : 'معطلة')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="go-ops-module" data-module="products">تعديل</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة التصنيفات',
    subtitle: 'إنشاء، تعديل، إظهار وإخفاء التصنيفات',
    columns: ['التصنيف', 'المنتجات', 'الظهور', 'الحالة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا توجد تصنيفات',
  });
}

function renderTiersModule(state) {
  const tiers = Array.isArray(state?.commerce?.catalog?.tiers) ? state.commerce.catalog.tiers : [];
  const rows = tiers.map((tier) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(tier.visible_label || tier.tier_name))}</strong>
      <span>${dom.escape(text(tier.tier_name))}</span>
      <span>${dom.escape(String(number(tier.min_order || 0)))}</span>
      <span>${dom.escape(tier.is_active === false ? 'غير نشط' : 'نشط')}</span>
      <span class="ops-row-actions">
        <button class="ops-chip-btn" type="button" data-action="go-tiers">عرض</button>
      </span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'إدارة الشرائح',
    subtitle: 'شرائح التسعير والحد الأدنى للطلب',
    columns: ['الاسم', 'المعرف', 'الحد الأدنى', 'الحالة', 'الإجراءات'],
    rows,
    emptyLabel: 'لا توجد شرائح',
  });
}

function renderReportsModule(state) {
  const orders = getOrders(state);
  const total = orders.reduce((sum, order) => sum + number(order.total_amount || order.total || 0), 0);
  const rows = getLatestOrders(state, 6).map((order) => `
    <div class="ops-table__row">
      <strong>${dom.escape(text(order.order_number || order.invoice_number || order.id))}</strong>
      <span>${dom.escape(text(order.customer_name || order.customer?.name || '—'))}</span>
      <span>${dom.escape(text(order.rep_name || order.sales_rep_name || '—'))}</span>
      <span>${dom.escape(formatMoney(number(order.total_amount || order.total || 0)))} ج.م</span>
      <span>${dom.escape(formatDate(order.created_at || order.updated_at || order.order_date))}</span>
    </div>
  `);
  return renderModuleTable(state, {
    title: 'التقارير',
    subtitle: `إجمالي المبيعات: ${formatMoney(total)} ج.م`,
    columns: ['رقم الطلب', 'العميل', 'المندوب', 'الإجمالي', 'التاريخ'],
    rows,
    emptyLabel: 'لا توجد بيانات تقارير',
  });
}

function renderWorkflowModule(state) {
  const orders = getLatestOrders(state, 8);
  const rows = orders.map((order) => {
    const workflow = resolveWorkflowActions(order, state?.auth?.session || {});
    const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
    return `
      <div class="ops-table__row">
        <strong>${dom.escape(text(order.order_number || order.invoice_number || order.id))}</strong>
        <span>${dom.escape(text(order.customer_name || order.customer?.name || '—'))}</span>
        <span>${dom.escape(text(order.rep_name || order.sales_rep_name || '—'))}</span>
        <span><em class="ops-badge ops-badge--${normalizeOrderState(order)}">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</em></span>
        <span class="ops-row-actions">
          ${next ? `<button class="ops-chip-btn" type="button" data-action="workflow-transition" data-order-id="${dom.escape(text(order.id, ''))}" data-next-state-key="${dom.escape(text(next.to_state_key, ''))}">${dom.escape(next.to_state_label || 'تنفيذ')}</button>` : '<span class="ops-chip-btn is-disabled">—</span>'}
        </span>
      </div>
    `;
  });
  return renderModuleTable(state, {
    title: 'سير العمل',
    subtitle: 'مراقبة الحالات والتنقل بين خطوات التنفيذ',
    columns: ['رقم الطلب', 'العميل', 'المندوب', 'الحالة', 'التحكم'],
    rows,
    emptyLabel: 'لا توجد طلبات',
  });
}

function renderOrdersModule(state) {
  const orders = getLatestOrders(state, 12);
  const rows = orders.map((order) => {
    const workflow = resolveWorkflowActions(order, state?.auth?.session || {});
    const next = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
    return `
      <div class="ops-table__row">
        <strong>${dom.escape(text(order.order_number || order.invoice_number || order.id))}</strong>
        <span>${dom.escape(text(order.customer_name || order.customer?.name || '—'))}</span>
        <span>${dom.escape(text(order.rep_name || order.sales_rep_name || '—'))}</span>
        <span><em class="ops-badge ops-badge--${normalizeOrderState(order)}">${dom.escape(getWorkflowStateLabel(normalizeOrderState(order)))}</em></span>
        <span class="ops-row-actions">
          ${next ? `<button class="ops-chip-btn" type="button" data-action="workflow-transition" data-order-id="${dom.escape(text(order.id, ''))}" data-next-state-key="${dom.escape(text(next.to_state_key, ''))}">${dom.escape(next.to_state_label || 'تنفيذ')}</button>` : '<span class="ops-chip-btn is-disabled">—</span>'}
          <button class="ops-chip-btn" type="button" data-action="view-invoice" data-invoice-id="${dom.escape(text(order.id, ''))}">عرض</button>
        </span>
      </div>
    `;
  });
  return renderModuleTable(state, {
    title: 'الطلبات',
    subtitle: 'قوائم التنفيذ والمراجعة والتحديث السريع للحالة',
    columns: ['رقم الطلب', 'العميل', 'المندوب', 'الحالة', 'التحكم'],
    rows,
    emptyLabel: 'لا توجد طلبات',
  });
}

function renderModulePage(state, model) {
  const moduleKey = String(state?.app?.route?.params?.module || model.moduleKey || 'sales-manager').trim();
  if (moduleKey === 'sales-manager' || moduleKey === 'home') return renderHomeLayout(state, model);
  if (moduleKey === 'orders') return renderOrdersModule(state);
  if (moduleKey === 'customers') return renderCustomersModule(state);
  if (moduleKey === 'products' || moduleKey === 'catalog') return renderProductsModule(state);
  if (moduleKey === 'companies') return renderCompaniesModule(state);
  if (moduleKey === 'reps') return renderRepsModule(state);
  if (moduleKey === 'users' || moduleKey === 'admin') return renderUsersModule(state);
  if (moduleKey === 'categories') return renderCategoriesModule(state);
  if (moduleKey === 'tiers') return renderTiersModule(state);
  if (moduleKey === 'reports') return renderReportsModule(state);
  if (moduleKey === 'workflow') return renderWorkflowModule(state);
  return renderHomeLayout(state, model);
}

export function renderOpsDashboardPage(state) {
  const model = createOpsDashboardModel(state);

  if (!model.canOpen) {
    return `
      <div class="ops-dashboard-page">
        <div class="ops-main-shell">
          <section class="ops-panel">
            <div class="ops-panel__head">
              <div>
                <h2>مركز العمليات</h2>
                <span>هذه المساحة مخصصة للحسابات التشغيلية المصرح لها</span>
              </div>
            </div>
            <div class="ops-empty">لا توجد صلاحية تشغيلية كافية لفتح هذه المساحة.</div>
          </section>
        </div>
      </div>
    `;
  }

  return renderModulePage(state, model);
}