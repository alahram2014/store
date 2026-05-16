import { dom } from '../core/dom.js';
import { getDefaultOperationalModule, getOperationalModules, getOperationalModuleLabel, getOperationalRouteForModule, isOperationalModuleReady } from '../services/managerService.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function isOperationalRoute(routeName) {
  return routeName === 'ops' || routeName === 'sales-manager';
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
  const routeName = state?.app?.route?.name || 'home';
  if (!session || !isOperationalRoute(routeName)) return '';

  const modules = getOperationalModules(session);
  if (!modules.length) return '';

  const activeModule = getCurrentModule(state);

  return `
    <section class="page-section ops-navigation">
      <div class="page-section__head page-section__head--tight">
        <div>
          <h2>لوحة التحكم</h2>
          <p>مساحة تشغيلية مستقلة وسريعة للوصول اليومي</p>
        </div>
        <span class="badge">${dom.escape(getOperationalModuleLabel(activeModule))}</span>
      </div>
      <div class="ops-navigation__row">
        ${modules.map((module) => {
          const active = activeModule === module.key;
          const ready = isOperationalModuleReady(module.key);
          const label = module.label || getOperationalModuleLabel(module.key);
          return `
            <button
              class="btn ${active ? 'btn--primary' : 'btn--ghost'} ops-navigation__btn ${active ? 'is-active' : ''} ${ready ? '' : 'ops-navigation__btn--locked'}"
              type="button"
              ${ready ? `data-action="go-ops-module" data-module="${dom.escape(module.key)}"` : 'disabled'}
            >
              <span>${dom.escape(label)}</span>
              <small>${dom.escape(module.statusLabel || (ready ? 'جاهز' : 'قريبًا'))}</small>
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
