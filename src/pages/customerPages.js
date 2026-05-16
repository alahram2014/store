import { dom } from '../core/dom.js';
import { customerCard } from '../components/cards.js';
import { invoiceCard } from '../components/cards.js';
import { canAccessCustomerManagement, canAccessOperationalDashboard, isSalesRepSession } from '../services/authService.js';

const THEME_LABELS = {
  'vip-light-theme': 'بيج فاخر',
  'premium-dark': 'داكن فاخر',
  'white-theme': 'أبيض',
  'orange-theme': 'برتقالي',
  'sky-blue-theme': 'أزرق',
  'green-yellow-theme': 'أخضر',
  'amazon-inspired-theme': 'أمازون',
};

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

function getRoleLabel(session) {
  const role = String(session?.userType || session?.user_type || '').trim();
  if (role === 'sales_rep') return 'مندوب';
  if (role === 'sales_manager') return 'مدير بيع';
  if (role === 'admin') return 'إداري';
  if (role === 'customer') return 'عميل';
  return role || '—';
}

function formatCapabilityLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '—';
  return CAPABILITY_LABELS[key] || key.split('.').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' • ');
}

function formatThemeLabel(value) {
  const key = String(value || '').trim();
  return THEME_LABELS[key] || key || '—';
}

function renderCapabilityChips(capabilities = []) {
  const labels = Array.from(new Set((Array.isArray(capabilities) ? capabilities : []).map(formatCapabilityLabel).filter(Boolean)));
  if (!labels.length) return '';
  return labels.map((label) => `<span class="chip">${dom.escape(label)}</span>`).join(' ');
}

export function renderCustomersPage(state) {
  const session = state.auth.session;
  const canManageCustomers = canAccessCustomerManagement(session);
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
  const showCustomers = canAccessCustomerManagement(session);
  const showDashboard = canAccessOperationalDashboard(session);
  const capabilities = Array.isArray(session?.capabilities) ? session.capabilities : [];
  return `
    <div class="page-stack">
      <section class="page-section">
        <div class="page-section__head"><div><h2>الحساب</h2><p>معلومات الجلسة والإعدادات</p></div></div>
        ${session ? `
          <div class="account-card">
            <div class="account-card__row"><span>الاسم</span><strong>${session.name || session.username || '—'}</strong></div>
            <div class="account-card__row"><span>النوع</span><strong>${getRoleLabel(session)}</strong></div>
            <div class="account-card__row"><span>الهاتف</span><strong>${session.phone || '—'}</strong></div>
            <div class="account-card__row"><span>النوع التصميمي</span><strong>${formatThemeLabel(state.ui.theme)}</strong></div>
            ${capabilities.length ? `
              <div class="account-card__row account-card__row--wrap"><span>الصلاحيات</span><strong>${renderCapabilityChips(capabilities)}</strong></div>
            ` : ''}
            <div class="account-card__actions">
              <button class="btn btn--ghost" type="button" data-action="logout">تسجيل الخروج</button>
              ${showCustomers ? '<button class="btn btn--ghost" type="button" data-action="go-customers">عملائي</button>' : ''}
              ${showDashboard ? '<button class="btn btn--ghost" type="button" data-action="go-ops">لوحة التحكم</button>' : ''}
              <button class="btn btn--primary" type="button" data-action="go-invoices">فواتيري</button>
            </div>
          </div>
        ` : '<div class="empty-state">غير مسجل الدخول</div>'}
      </section>
    </div>
  `;
}
