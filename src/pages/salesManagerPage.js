import { dom } from '../core/dom.js';
import { customerCard } from '../components/cards.js';
import { formatMoney } from '../services/invoiceService.js';
import { canAccessOperationalDashboard } from '../services/authService.js';
import {
  getDefaultOperationalModule,
  getOperationalModuleByKey,
  getOperationalModuleLabel,
  getOperationalModules,
  getOperationalQuickActions,
  getOperationalRouteForModule,
  isOperationalModuleReady,
} from '../services/managerService.js';
import { resolveWorkflowActions, getWorkflowStateLabel } from '../services/workflowService.js';

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

function getCustomerName(order, customerMap) {
  const customerId = String(order?.customer_id || '').trim();
  const mapped = customerMap[customerId];
  if (mapped?.name) return mapped.name;
  return order?.customer_name || order?.name || `عميل #${customerId.slice(0, 6) || '—'}`;
}

function renderSummary(summary = {}) {
  const cards = [
    ['العملاء', summary.customers || 0, 'مرتبطون بالحساب'],
    ['المندوبون', summary.reps || 0, 'الهيكل التشغيلي'],
    ['الطلبات', summary.orders || 0, 'إجمالي الطلبات'],
    ['تحت المراجعة', summary.reviewing || 0, 'بحاجة متابعة'],
    ['جاري التحضير', summary.preparing || 0, 'في المخزن'],
    ['خرج للشحن', summary.dispatched || 0, 'قيد النقل'],
    ['تم التسليم', summary.delivered || 0, 'تم التسليم للعميل'],
    ['تم التحصيل', summary.collected || 0, 'مغلق ماليًا'],
  ];

  return `
    <div class="ops-metric-grid">
      ${cards.map(([label, value, hint]) => `
        <article class="ops-metric-card">
          <span class="ops-metric-card__label">${dom.escape(label)}</span>
          <strong class="ops-metric-card__value">${dom.escape(String(value))}</strong>
          <span class="ops-metric-card__hint">${dom.escape(hint)}</span>
        </article>
      `).join('')}
    </div>
  `;
}

function renderQuickActions(session, module) {
  const actions = getOperationalQuickActions(session);
  const moduleName = module === 'sales-manager' ? 'مدير البيع' : getOperationalModuleLabel(module);
  const preferred = actions.filter((action) => ['dashboard', 'customers', 'checkout', 'invoices'].includes(action.key));
  const modules = getOperationalModules(session);

  return `
    <section class="page-section ops-section">
      <div class="page-section__head">
        <div>
          <h2>تنفيذ سريع</h2>
          <p>${dom.escape(moduleName)} — أهم ما يحتاجه المستخدم الآن</p>
        </div>
        <span class="badge">إجراءات مباشرة</span>
      </div>
      <div class="ops-quick-actions">
        ${preferred.map((action) => `
          <button class="ops-action-card" type="button" data-action="${dom.escape(action.action)}">
            <span class="ops-action-card__icon">${dom.escape(action.icon || '•')}</span>
            <span class="ops-action-card__body">
              <strong>${dom.escape(action.label)}</strong>
              <small>${dom.escape(action.description || '')}</small>
            </span>
          </button>
        `).join('')}
      </div>
      <div class="ops-module-row">
        ${modules.map((item) => `
          <button
            class="ops-module-pill ${item.isReady ? 'is-ready' : 'is-locked'}"
            type="button"
            ${item.isReady ? `data-action="go-ops-module" data-module="${dom.escape(item.key)}"` : 'disabled'}
          >
            <span>${dom.escape(item.label)}</span>
            <small>${dom.escape(item.statusLabel)}</small>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderEmptyModulePlaceholder(module) {
  const descriptor = getOperationalModuleByKey(module) || { label: module, description: 'وحدة تشغيلية' };
  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>${dom.escape(descriptor.label || module)}</h2>
            <p>${dom.escape(descriptor.description || 'وحدة تشغيلية')}</p>
          </div>
          <span class="badge">قريبًا</span>
        </div>
        <div class="empty-state">
          هذه الوحدة غير مفعلة بعد. ستظهر هنا عندما تصبح جاهزة للتنفيذ.
        </div>
        <div class="account-card__actions" style="margin-top: 1rem;">
          <button class="btn btn--ghost" type="button" data-action="go-ops">العودة إلى لوحة التحكم</button>
        </div>
      </section>
    </div>
  `;
}

function renderExecutionCard(order, session, customerMap) {
  const workflow = resolveWorkflowActions(order, session);
  const transitions = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions : [];
  const firstTransition = transitions[0] || null;
  const orderNumber = order.order_number || order.invoice_number || order.id;
  const customerName = getCustomerName(order, customerMap);
  const total = formatMoney(Number(order.total_amount || 0));
  const statusLabel = workflow.currentStateLabel || getWorkflowStateLabel(order.workflow_state_key || order.workflow_status || order.status);
  const actionLabel = firstTransition?.to_state_label || firstTransition?.to_state_key || 'تغيير الحالة';

  return `
    <article class="ops-execution-card">
      <div class="ops-execution-card__head">
        <div>
          <h3>طلب #${dom.escape(String(orderNumber))}</h3>
          <p>${dom.escape(customerName)}</p>
        </div>
        <span class="badge">${dom.escape(statusLabel)}</span>
      </div>
      <div class="ops-execution-card__meta">
        <span class="chip">${dom.escape(total)} ج.م</span>
        <span class="chip">${dom.escape(statusLabel)}</span>
        ${transitions.length ? `<span class="chip">${dom.escape(String(transitions.length))} إجراء</span>` : '<span class="chip">لا توجد إجراءات</span>'}
      </div>
      <div class="ops-execution-card__footer">
        ${firstTransition ? `
          <button class="btn btn--primary" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(firstTransition.to_state_key || ''))}">
            ابدأ ${dom.escape(actionLabel)}
          </button>
        ` : '<span class="badge">لا توجد إجراءات متاحة</span>'}
        <button class="btn btn--ghost" type="button" data-action="view-invoice" data-invoice-id="${dom.escape(String(order.id || ''))}">عرض الفاتورة</button>
      </div>
      ${transitions.length > 1 ? `
        <div class="workflow-actions workflow-actions--compact">
          ${transitions.slice(1).map((transition) => `
            <button class="btn btn--ghost workflow-actions__btn" type="button" data-action="workflow-transition" data-order-id="${dom.escape(String(order.id || ''))}" data-next-state-key="${dom.escape(String(transition.to_state_key || ''))}">
              ${dom.escape(transition.to_state_label || transition.to_state_key || 'تغيير الحالة')}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

function renderModulePlaceholder(module, summary) {
  const descriptor = getOperationalModuleByKey(module) || { label: module, description: 'وحدة تشغيلية' };
  return `
    <section class="page-section">
      <div class="page-section__head">
        <div>
          <h2>${dom.escape(descriptor.label || module)}</h2>
          <p>${dom.escape(descriptor.description || 'وحدة تشغيلية')}</p>
        </div>
        <span class="badge">قريبًا</span>
      </div>
      ${renderSummary(summary)}
      <div class="empty-state">
        هذه الوحدة غير مفعلة بعد. سيُعرض فيها التشغيل الفعلي عند اكتمال الدعم التنفيذي.
      </div>
    </section>
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
  const teamOrders = Array.isArray(managerScope.priorityOrders) && managerScope.priorityOrders.length
    ? managerScope.priorityOrders
    : (Array.isArray(managerScope.teamOrders) ? managerScope.teamOrders : []);
  const teamReps = Array.isArray(managerScope.teamReps) ? managerScope.teamReps : [];
  const busy = Boolean(state.runtime?.loading?.manager || managerScope.loading);
  const modules = getOperationalModules(session);
  const moduleDescriptor = getOperationalModuleByKey(module) || { label: getOperationalModuleLabel(module), description: 'وحدة تشغيلية' };
  const customerMap = Object.fromEntries(
    teamCustomers.map((customer) => [String(customer.id), customer]).filter(Boolean)
  );

  if (busy) {
    return `
      <div class="page-stack">
        <section class="page-section">
          <div class="empty-state">جارٍ تحميل مساحة التشغيل…</div>
        </section>
      </div>
    `;
  }

  if (!isOperationalModuleReady(module) && module !== 'sales-manager' && module !== 'sales') {
    return `
      <div class="page-stack">
        ${renderModulePlaceholder(module, summary)}
      </div>
    `;
  }

  return `
    <div class="page-stack ops-workspace">
      <section class="page-section ops-hero">
        <div class="page-section__head">
          <div>
            <h2>${dom.escape(moduleDescriptor.label || 'لوحة التحكم')}</h2>
            <p>${dom.escape(moduleDescriptor.description || 'مركز تنفيذ يومي سريع')}</p>
          </div>
          <span class="badge ${isOperationalModuleReady(module) ? 'badge--success' : ''}">${dom.escape(isOperationalModuleReady(module) ? 'جاهز للتنفيذ' : 'قريبًا')}</span>
        </div>
        ${renderSummary(summary)}
      </section>

      ${renderQuickActions(session, module)}

      <section class="page-section ops-section">
        <div class="page-section__head">
          <div>
            <h2>الأولوية الآن</h2>
            <p>أهم الطلبات التي تحتاج إجراء سريع</p>
          </div>
          <span class="badge">${dom.escape(String(teamOrders.length || 0))} طلب</span>
        </div>
        <div class="ops-execution-list">
          ${teamOrders.map((order) => renderExecutionCard(order, session, customerMap)).join('') || '<div class="empty-state">لا توجد طلبات حالياً</div>'}
        </div>
      </section>

      <section class="page-section ops-section">
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

      <section class="page-section ops-section">
        <div class="page-section__head">
          <div>
            <h2>المندوبون</h2>
            <p>الهيكل التشغيلي المرتبط</p>
          </div>
        </div>
        <div class="customer-grid">
          ${teamReps.length ? teamReps.map((rep) => `
            <article class="account-card">
              <div class="account-card__row"><span>الاسم</span><strong>${dom.escape(rep.full_name || rep.name || rep.username || '—')}</strong></div>
              <div class="account-card__row"><span>الهاتف</span><strong>${dom.escape(rep.phone || '—')}</strong></div>
              <div class="account-card__row"><span>النوع</span><strong>${dom.escape(rep.user_type || '—')}</strong></div>
              ${rep.blocked_reason ? `<div class="badge">${dom.escape(rep.blocked_reason)}</div>` : ''}
            </article>
          `).join('') : '<div class="empty-state">لا توجد بيانات مندوبين حالياً</div>'}
        </div>
      </section>

      <section class="page-section ops-section">
        <div class="page-section__head">
          <div>
            <h2>الوحدات التشغيلية</h2>
            <p>الوحدات المتاحة حسب الصلاحيات</p>
          </div>
        </div>
        <div class="ops-module-grid">
          ${modules.map((item) => `
            <button
              class="ops-module-card ${item.isReady ? 'is-ready' : 'is-locked'}"
              type="button"
              ${item.isReady ? `data-action="go-ops-module" data-module="${dom.escape(item.key)}"` : 'disabled'}
            >
              <div class="ops-module-card__head">
                <strong>${dom.escape(item.label)}</strong>
                <span class="badge">${dom.escape(item.statusLabel)}</span>
              </div>
              <p>${dom.escape(item.description || '')}</p>
            </button>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}
