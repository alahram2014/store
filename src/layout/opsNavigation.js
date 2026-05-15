import { dom } from '../core/dom.js';
import { hasCapability } from '../services/authService.js';
import { getDefaultOperationalModule, getOperationalModules, getOperationalRouteForModule } from '../services/managerService.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function getCurrentModule(state) {
  const route = state?.app?.route || {};
  if (route.name === 'ops') return normalizeText(route.params?.module || 'sales-manager');
  if (route.name === 'sales-manager') return 'sales-manager';
  return getDefaultOperationalModule(state?.auth?.session || {});
}

function isModuleActive(state, moduleKey) {
  return getCurrentModule(state) === normalizeText(moduleKey);
}

export function renderOpsNavigation(state) {
  const session = state?.auth?.session || null;
  if (!session) return '';

  const modules = getOperationalModules(session);
  if (!modules.length) return '';

  const activeModule = getCurrentModule(state);

  return `
    <section class="page-section ops-navigation">
      <div class="page-section__head page-section__head--tight">
        <div>
          <h2>العمليات</h2>
          <p>التحكم التشغيلي حسب الصلاحيات</p>
        </div>
        <span class="badge">${dom.escape(String(activeModule || '—'))}</span>
      </div>
      <div class="ops-navigation__row">
        ${modules.map((module) => {
          const active = activeModule === module.key;
          return `
            <button class="btn ${active ? 'btn--primary' : 'btn--ghost'} ops-navigation__btn ${active ? 'is-active' : ''}" type="button" data-action="go-ops-module" data-module="${dom.escape(module.key)}" data-route="${dom.escape(getOperationalRouteForModule(module.key))}">
              ${dom.escape(module.label)}
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

export function createOpsNavigationFacade() {
  return {
    renderOpsNavigation,
    getCurrentModule,
    isModuleActive,
    getOperationalModules,
    getOperationalRouteForModule,
    getDefaultOperationalModule,
  };
}
