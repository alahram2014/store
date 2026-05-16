import { dom } from '../core/dom.js';
import { getDefaultOperationalModule, getOperationalModules, getOperationalModuleLabel, isOperationalModuleReady } from '../services/managerService.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function getCurrentModule(state) {
  const route = state?.app?.route || {};
  if (route.name === 'ops') return normalizeText(route.params?.module || 'sales-manager');
  if (route.name === 'sales-manager') return 'sales-manager';
  return getDefaultOperationalModule(state?.auth?.session || {});
}

export function renderOpsNavigation(state) {
  const session = state?.auth?.session || null;
  const routeName = state?.app?.route?.name || 'home';
  if (!session || (routeName !== 'ops' && routeName !== 'sales-manager')) return '';

  const modules = getOperationalModules(session);
  if (!modules.length) return '';

  const activeModule = getCurrentModule(state);

  return `
    <section class="ops-nav-shell">
      <div class="ops-nav-shell__header">
        <div>
          <strong>الوحدات التشغيلية</strong>
          <p>تنقل سريع داخل مركز القيادة</p>
        </div>
        <span class="badge">${dom.escape(getOperationalModuleLabel(activeModule))}</span>
      </div>
      <div class="ops-nav-shell__row">
        ${modules.map((module) => {
          const active = activeModule === module.key;
          const ready = isOperationalModuleReady(module.key);
          return `
            <button
              class="ops-nav-chip ${active ? 'is-active' : ''} ${ready ? '' : 'is-locked'}"
              type="button"
              ${ready ? `data-action="go-ops-module" data-module="${dom.escape(module.key)}"` : 'disabled'}
            >
              <span>${dom.escape(module.label || module.key)}</span>
              <small>${dom.escape(module.statusLabel || (ready ? 'جاهز' : 'قريبًا'))}</small>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}
