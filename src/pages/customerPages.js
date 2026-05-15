import { customerCard, invoiceCard } from '../components/cards.js';
import { isSalesRepSession } from '../services/authService.js';

function getRoleLabel(session) {
  const role = String(session?.userType || session?.user_type || '').trim();
  if (role === 'sales_rep') return 'مندوب';
  if (role === 'admin') return 'إداري';
  if (role === 'customer') return 'عميل';
  return role || '—';
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function renderSearchBar(query, placeholder) {
  return `
    <div class="search-page__input-row search-page__input-row--compact">
      <input id="searchInput" type="search" placeholder="${placeholder}" value="${String(query ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}" dir="auto" autocomplete="off" />
      <button class="btn btn--ghost" type="button" data-action="clear-search">مسح</button>
    </div>
  `;
}

export function renderCustomersPage(state) {
  const session = state.auth.session || {};
  const canViewOperationalCustomers = isSalesRepSession(session) || Boolean(session.system_user);
  if (!canViewOperationalCustomers) {
    return `<section class="empty-panel"><div class="empty-state">هذه الصفحة متاحة للحساب التشغيلي المرتبط فقط</div></section>`;
  }
  const customers = state.commerce.customers || [];
  const selectedId = state.auth.selectedCustomer?.id;
  const pendingFlow = state.ui.pendingFlow;
  const q = normalize(state.ui.search);
  const visibleCustomers = q
    ? customers.filter((customer) => normalize(customer.name).includes(q) || normalize(customer.phone).includes(q) || normalize(customer.id).includes(q))
    : customers;

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
        ${renderSearchBar(state.ui.search, 'بحث بالاسم أو الهاتف أو رقم العميل')}
        ${pendingFlow?.name === 'checkout' ? '<div class="badge">بعد الاختيار سيتم فتح شاشة إتمام الطلب مباشرة</div>' : ''}
        <div class="customer-grid">${visibleCustomers.map((customer) => customerCard(customer, String(customer.id) === String(selectedId))).join('') || '<div class="empty-state">لا توجد عملاء مطابقة</div>'}</div>
      </section>
    </div>
  `;
}

export function renderInvoicesPage(state) {
  const invoices = state.commerce.invoices || [];
  const q = normalize(state.ui.search);
  const visibleInvoices = q
    ? invoices.filter((invoice) => [
      invoice.order_number,
      invoice.invoice_number,
      invoice.customer_name,
      invoice.customer_phone,
      invoice.sales_rep_name,
      invoice.sales_rep_phone,
      invoice.id,
    ].some((field) => normalize(field).includes(q)))
    : invoices;

  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head">
          <div>
            <h2>فواتيري</h2>
            <p>الطلبات السابقة</p>
          </div>
        </div>
        ${renderSearchBar(state.ui.search, 'بحث برقم الفاتورة أو اسم العميل أو الهاتف')}
        <div class="invoice-grid">${visibleInvoices.map(invoiceCard).join('') || '<div class="empty-state">لا توجد فواتير مطابقة</div>'}</div>
      </section>
    </div>
  `;
}

export function renderAccountPage(state) {
  const session = state.auth.session;
  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head"><div><h2>الحساب</h2><p>معلومات الجلسة والإعدادات</p></div></div>
        ${session ? `
          <div class="account-card">
            <div class="account-card__row"><span>الاسم</span><strong>${session.name || session.username || '—'}</strong></div>
            <div class="account-card__row"><span>النوع</span><strong>${getRoleLabel(session)}</strong></div>
            <div class="account-card__row"><span>الهاتف</span><strong>${session.phone || '—'}</strong></div>
            <div class="account-card__row"><span>النوع التصميمي</span><strong>${state.ui.theme}</strong></div>
            <div class="account-card__actions">
              <button class="btn btn--ghost" type="button" data-action="logout">تسجيل الخروج</button>
              <button class="btn btn--primary" type="button" data-action="go-invoices">فواتيري</button>
            </div>
          </div>
        ` : '<div class="empty-state">غير مسجل الدخول</div>'}
      </section>
    </div>
  `;
}
