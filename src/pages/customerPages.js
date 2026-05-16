import { dom } from '../core/dom.js';
import { customerCard } from '../components/cards.js';
import { invoiceCard } from '../components/cards.js';
import { isSalesRepSession } from '../services/authService.js';

function getRoleLabel(session) {
  const role = String(session?.userType || session?.user_type || '').trim();
  if (role === 'sales_rep') return 'مندوب';
  if (role === 'sales_manager') return 'مدير بيع';
  if (role === 'admin') return 'إداري';
  if (role === 'customer') return 'عميل';
  return role || '—';
}

function renderAccountQuickActions(session) {
  const actions = [
    { action: 'go-account', label: 'حسابي', icon: '👤', visible: true },
    { action: 'go-invoices', label: 'فواتيري', icon: '📦', visible: true },
    { action: 'go-customers', label: 'عملائي', icon: '👥', visible: isSalesRepSession(session) },
  ].filter((item) => item.visible);

  return `
    <div class="ops-quick-actions ops-quick-actions--account">
      ${actions.map((item) => `
        <button class="ops-action-card" type="button" data-action="${dom.escape(item.action)}">
          <span class="ops-action-card__icon">${dom.escape(item.icon)}</span>
          <span class="ops-action-card__body">
            <strong>${dom.escape(item.label)}</strong>
            <small>${dom.escape(item.action === 'go-ops' ? 'المساحة التشغيلية المستقلة' : item.action === 'go-customers' ? 'العملاء المرتبطون بالحساب' : item.action === 'go-invoices' ? 'الفواتير السابقة' : 'إعدادات الجلسة')}</small>
          </span>
        </button>
      `).join('')}
    </div>
  `;
}

export function renderCustomersPage(state) {
  const session = state.auth.session;
  const canManageCustomers = isSalesRepSession(session);
  if (!canManageCustomers) {
    return `<section class="empty-panel"><div class="empty-state">هذه الصفحة متاحة للحسابات المصرح لها فقط</div></section>`;
  }

  const managerCustomers = state.runtime?.manager?.teamCustomers || [];
  const customers = isSalesRepSession(session)
    ? (state.commerce.customers || [])
    : (managerCustomers.length ? managerCustomers : (state.commerce.customers || []));
  const selectedId = state.auth.selectedCustomer?.id;
  const pendingFlow = state.ui.pendingFlow;

  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>عملائي</h2>
            <p>${pendingFlow?.name === 'checkout' ? 'يجب اختيار العميل أولًا' : 'إدارة العملاء المرتبطين بالحساب التشغيلي'}</p>
          </div>
          <button class="btn btn--primary" type="button" data-action="open-customer-modal">إضافة عميل</button>
        </div>
        ${pendingFlow?.name === 'checkout' ? '<div class="badge">بعد الاختيار سيتم فتح شاشة إتمام الطلب مباشرة</div>' : ''}
        <div class="customer-grid">${customers.map((customer) => customerCard(customer, String(customer.id) === String(selectedId))).join('') || '<div class="empty-state">لا توجد عملاء</div>'}</div>
      </section>
    </div>
  `;
}

export function renderInvoicesPage(state) {
  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head"><div><h2>فواتيري</h2><p>الطلبات السابقة</p></div></div>
        <div class="invoice-grid">${(state.commerce.invoices || []).map(invoiceCard).join('') || '<div class="empty-state">لا توجد فواتير</div>'}</div>
      </section>
    </div>
  `;
}

export function renderAccountPage(state) {
  const session = state.auth.session;
  const showCustomers = isSalesRepSession(session);

  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>الحساب</h2>
            <p>معلومات الجلسة والوصول السريع</p>
          </div>
          <span class="badge">${dom.escape(getRoleLabel(session))}</span>
        </div>
        ${session ? `
          <div class="account-card">
            <div class="account-card__row"><span>الاسم</span><strong>${session.name || session.username || '—'}</strong></div>
            <div class="account-card__row"><span>الهاتف</span><strong>${session.phone || '—'}</strong></div>
            <div class="account-card__row"><span>النوع التصميمي</span><strong>${state.ui.theme}</strong></div>
            <div class="account-card__actions">
              <button class="btn btn--ghost" type="button" data-action="go-invoices">فواتيري</button>
              ${showCustomers ? '<button class="btn btn--ghost" type="button" data-action="go-customers">عملائي</button>' : ''}
              <button class="btn btn--primary" type="button" data-action="logout">تسجيل الخروج</button>
            </div>
          </div>
          ${renderAccountQuickActions(session)}
        ` : '<div class="empty-state">غير مسجل الدخول</div>'}
      </section>
    </div>
  `;
}
