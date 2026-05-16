import { dom } from '../core/dom.js';
import { getDefaultOperationalModule, getOperationalModuleLabel, isOperationalModuleReady } from '../services/managerService.js';

const OPS_ITEMS = [
  { key: 'sales-manager', label: 'الرئيسية', icon: '⌂', module: 'sales-manager' },
  { key: 'orders', label: 'الفواتير والطلبات', icon: '🧾', module: 'orders' },
  { key: 'customers', label: 'العملاء', icon: '👥', module: 'customers' },
  { key: 'products', label: 'المنتجات', icon: '▣', module: 'products' },
  { key: 'companies', label: 'الشركات', icon: '🏢', module: 'companies' },
  { key: 'reps', label: 'المناديب', icon: '☻', module: 'reps' },
  { key: 'users', label: 'المستخدمين والصلاحيات', icon: '⚙', module: 'users' },
  { key: 'reports', label: 'التقارير', icon: '▤', module: 'reports' },
  { key: 'workflow', label: 'سجل النشاطات', icon: '◔', module: 'workflow' },
];

function getCurrentModule(state) {
  const route = state?.app?.route || {};
  if (route.name === 'ops') return String(route.params?.module || getDefaultOperationalModule(state?.auth?.session || {})).trim();
  if (route.name === 'sales-manager') return 'sales-manager';
  return getDefaultOperationalModule(state?.auth?.session || {});
}

function getSessionLabel(session = {}) {
  return session.full_name || session.name || session.username || 'مدير النظام';
}

export function renderOpsNavigation(state) {
  const session = state?.auth?.session || null;
  const routeName = state?.app?.route?.name || 'home';
  if (!session || (routeName !== 'ops' && routeName !== 'sales-manager')) return '';

  const activeModule = getCurrentModule(state);
  const moduleLabel = getOperationalModuleLabel(activeModule);

  return `
    <aside class="ops-sidebar" aria-label="التنقل التشغيلي">
      <div class="ops-sidebar__brand">
        <div class="ops-sidebar__brand-mark">◈</div>
        <div class="ops-sidebar__brand-copy">
          <strong>أوجد</strong>
          <span>نظام التوزيع والمبيعات</span>
        </div>
        <button class="ops-sidebar__menu-btn" type="button" aria-label="قائمة">☰</button>
      </div>

      <nav class="ops-sidebar__nav">
        ${OPS_ITEMS.map((item) => {
          const active = activeModule === item.module || (item.module === 'sales-manager' && activeModule === 'sales-manager');
          const ready = isOperationalModuleReady(item.module);
          return `
            <button
              class="ops-sidebar__item ${active ? 'is-active' : ''} ${ready ? '' : 'is-locked'}"
              type="button"
              ${ready ? `data-action="go-ops-module" data-module="${dom.escape(item.module)}"` : 'disabled'}
            >
              <span class="ops-sidebar__icon">${dom.escape(item.icon)}</span>
              <span class="ops-sidebar__label">${dom.escape(item.label)}</span>
              ${active ? '<span class="ops-sidebar__chev">›</span>' : ''}
            </button>
          `;
        }).join('')}
      </nav>

      <div class="ops-sidebar__footer">
        <div class="ops-sidebar__status-card">
          <div class="ops-sidebar__status-title">الصلاحية الحالية</div>
          <div class="ops-sidebar__status-value">${dom.escape(moduleLabel || 'الرئيسية')}</div>
          <div class="ops-sidebar__status-user">
            <strong>${dom.escape(getSessionLabel(session))}</strong>
            <span>${dom.escape(session.user_type || session.userType || 'operational')}</span>
          </div>
        </div>

        <button class="ops-sidebar__logout" type="button" data-action="logout">
          <span>↩</span>
          <strong>تسجيل خروج</strong>
        </button>
      </div>
    </aside>
  `;
}