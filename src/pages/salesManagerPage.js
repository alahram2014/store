import { dom } from '../core/dom.js';
import { customerCard, invoiceCard, renderWorkflowActionButtons } from '../components/cards.js';
import { getDefaultOperationalModule, getOperationalModuleByKey, getOperationalModules } from '../services/managerService.js';

const CAPABILITY_LABELS = {
  'orders.view': 'عرض الطلبات',
  'orders.create': 'إنشاء طلب',
  'orders.review': 'مراجعة الطلبات',
  'orders.change_status': 'تغيير الحالة',
  'customers.create': 'إضافة عميل',
  'warehouse.prepare': 'التحضير',
  'shipment.dispatch': 'الشحن',
  'delivery.execute': 'التسليم',
  'returns.receive': 'المرتجعات',
  'reports.view': 'التقارير',
  'system.manage_dashboard': 'لوحة التحكم',
  'sales_manager.access': 'مدير البيع',
  'sales_manager.manage_reps': 'إدارة المندوبين',
  'sales_manager.assign_customers': 'ربط العملاء',
  'sales_manager.view_team_orders': 'طلبات الفريق',
  'sales_manager.view_team_performance': 'أداء الفريق',
  'dashboard.admin': 'لوحة الإدارة',
  'dashboard.sales_manager': 'لوحة مدير البيع',
  'dashboard.warehouse': 'لوحة المخزن',
  'dashboard.delivery': 'لوحة الشحن',
  'dashboard.treasury': 'لوحة الخزنة',
  'dashboard.hr': 'شؤون العاملين',
};

function formatCapabilityLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '—';
  return CAPABILITY_LABELS[key] || key.split('.').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' • ');
}

function normalizeModuleKey(value) {
  return String(value || '').trim() || 'sales-manager';
}

function getActiveModule(state) {
  const route = state?.app?.route || {};
  if (route.name === 'ops') return normalizeModuleKey(route.params?.module);
  if (route.name === 'sales-manager') return 'sales-manager';
  return getDefaultOperationalModule(state?.auth?.session || {});
}

function canOpenOperationalRuntime(session) {
  return getOperationalModules(session).length > 0;
}

function renderReps(reps = []) {
  if (!Array.isArray(reps) || !reps.length) {
    return '<div class="empty-state">لا توجد بيانات مندوبين حالياً</div>';
  }
  return reps.map((rep) => `
    <article class="account-card">
      <div class="account-card__row"><span>الاسم</span><strong>${dom.escape(rep.full_name || rep.name || rep.username || '—')}</strong></div>
      <div class="account-card__row"><span>الهاتف</span><strong>${dom.escape(rep.phone || '—')}</strong></div>
      <div class="account-card__row"><span>النوع</span><strong>${dom.escape(rep.user_type || '—')}</strong></div>
      ${rep.blocked_reason ? `<div class="badge">${dom.escape(rep.blocked_reason)}</div>` : ''}
    </article>
  `).join('');
}

function renderSummary(summary = {}) {
  const chips = [
    ['العملاء', summary.customers || 0],
    ['المندوبون', summary.reps || 0],
    ['الطلبات', summary.orders || 0],
    ['تحت المراجعة', summary.reviewing || 0],
    ['جاري التحضير', summary.preparing || 0],
    ['خرج للشحن', summary.dispatched || 0],
    ['تم التسليم', summary.delivered || 0],
    ['تم التحصيل', summary.collected || 0],
  ];
  return `
    <div class="badge-row">
      ${chips.map(([label, value]) => `<span class="badge">${dom.escape(label)}: ${dom.escape(String(value))}</span>`).join('')}
    </div>
  `;
}

function renderCapabilityChips(capabilities = []) {
  const labels = Array.from(new Set((Array.isArray(capabilities) ? capabilities : []).map(formatCapabilityLabel).filter(Boolean)));
  if (!labels.length) return '';
  return labels.map((label) => `<span class="chip">${dom.escape(label)}</span>`).join(' ');
}

function renderModulePlaceholder(module, session, summary) {
  const descriptor = getOperationalModuleByKey(module) || { label: module, description: 'وحدة تشغيلية' };
  return `
    <section class="page-section">
      <div class="page-section__head">
        <div>
          <h2>${dom.escape(descriptor.label || module)}</h2>
          <p>${dom.escape(descriptor.description || 'وحدة تشغيلية')}</p>
        </div>
        <span class="badge">${dom.escape(descriptor.label || module)}</span>
      </div>
      ${renderSummary(summary)}
      <div class="empty-state">هذه الوحدة جاهزة كواجهة تشغيلية لاحقاً مع نفس runtime والصلاحيات الحالية.</div>
      <div class="account-card__actions" style="margin-top: 1rem;">
        <button class="btn btn--ghost" type="button" data-action="go-ops-module" data-module="sales-manager">مدير البيع</button>
        <button class="btn btn--ghost" type="button" data-action="go-customers">العملاء</button>
        <button class="btn btn--ghost" type="button" data-action="go-invoices">الفواتير</button>
      </div>
    </section>
  `;
}

function renderWorkflowOrderCard(order, session) {
  return `
    <div class="sales-manager__order-card">
      ${invoiceCard(order)}
      ${renderWorkflowActionButtons(order, session, { compact: false })}
    </div>
  `;
}

export function renderSalesManagerPage(state) {
  const session = state.auth.session;
  if (!canOpenOperationalRuntime(session)) {
    return `<section class="empty-panel"><div class="empty-state">هذه الصفحة متاحة للحساب التشغيلي المرتبط بالصلاحيات فقط</div></section>`;
  }

  const module = getActiveModule(state);
  const managerScope = state.runtime?.manager || {};
  const summary = managerScope.summary || {};
  const teamCustomers = Array.isArray(managerScope.teamCustomers) ? managerScope.teamCustomers : [];
  const teamOrders = Array.isArray(managerScope.teamOrders) ? managerScope.teamOrders : [];
  const teamReps = Array.isArray(managerScope.teamReps) ? managerScope.teamReps : [];
  const capabilities = Array.isArray(session?.capabilities) ? session.capabilities : [];
  const busy = Boolean(state.runtime?.loading?.manager || managerScope.loading);

  if (busy) {
    return `
      <div class="page-stack">
        <section class="page-section">
          <div class="empty-state">جارٍ تحميل التشغيل الإداري…</div>
        </section>
      </div>
    `;
  }

  if (module !== 'sales-manager' && module !== 'sales') {
    return `
      <div class="page-stack">
        ${renderModulePlaceholder(module, session, summary)}
      </div>
    `;
  }

  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>${module === 'sales-manager' ? 'لوحة مدير البيع' : 'لوحة المبيعات'}</h2>
            <p>${module === 'sales-manager' ? 'متابعة المندوبين والعملاء المرتبطين والتشغيل اليومي' : 'واجهة تشغيلية مبسطة للمبيعات والعملاء'}</p>
          </div>
          <span class="badge">${dom.escape(getOperationalModuleByKey(module)?.label || module)}</span>
        </div>
        ${renderSummary(summary)}
        ${capabilities.length ? `<div class="account-card__row account-card__row--wrap" style="margin-top: 0.75rem;"><span>الصلاحيات</span><strong>${renderCapabilityChips(capabilities)}</strong></div>` : ''}
      </section>

      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>العملاء</h2>
            <p>العملاء المرتبطون بالحساب التشغيلي</p>
          </div>
          <button class="btn btn--primary" type="button" data-action="open-customer-modal">إضافة عميل</button>
        </div>
        <div class="customer-grid">
          ${teamCustomers.map((customer) => customerCard(customer, Boolean(state.auth.selectedCustomer && String(state.auth.selectedCustomer.id) === String(customer.id)))).join('') || '<div class="empty-state">لا توجد عملاء</div>'}
        </div>
      </section>

      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>المندوبون</h2>
            <p>الفريق التشغيلي المرتبط</p>
          </div>
        </div>
        <div class="customer-grid">
          ${renderReps(teamReps)}
        </div>
      </section>

      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>الطلبات</h2>
            <p>الطلبات المرتبطة بالفريق أو العملاء</p>
          </div>
          <button class="btn btn--ghost" type="button" data-action="go-invoices">كل الفواتير</button>
        </div>
        <div class="invoice-grid">
          ${teamOrders.map((order) => renderWorkflowOrderCard(order, session)).join('') || '<div class="empty-state">لا توجد طلبات حالياً</div>'}
        </div>
      </section>
    </div>
  `;
}
