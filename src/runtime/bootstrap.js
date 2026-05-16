import { readConfig } from '../core/config.js';
import { dom } from '../core/dom.js';
import { parseRoute, navigate } from '../core/router.js';
import { createEmitter, createRenderLoop } from '../core/events.js';
import { createStore } from '../state/store.js';
import { createInitialState } from '../state/defaultState.js';
import { computeCartTotals, getSelectedTier } from '../state/selectors.js';
import { createApiClient } from '../services/apiClient.js';
import { loadHomeCatalog, loadCompanyCatalog, loadProductsByIds, aggregateRuntimeProducts, projectRuntimeProducts } from '../services/catalogService.js';
import { buildPriceBook, persistSelectedTier, resolveProductUnit, syncCartPrices, normalizeTierName } from '../services/pricingService.js';
import { addProductToCart, clearCart, computeTotals, hydrateCart, persistCart, recalcCart, removeItem, toggleOfferInCart, updateQty } from '../services/cartService.js';
import { login, logout, registerCustomer, normalizeUserType, normalizeSessionRecord, isSalesRepSession, getOwnershipActorId, hasCapability, persistSessionRecord, readPersistedSession, canAccessCustomerManagement, canAccessOperationalDashboard } from '../services/authService.js';
import { loadRepCustomers, createCustomer, persistSelectedCustomer } from '../services/customerService.js';
import { loadManagerScopeIntoState, hasOperationalAccess, getDefaultOperationalModule, isOperationalModuleReady } from '../services/managerService.js';
import { renderOpsNavigation } from '../layout/opsNavigation.js';
import { loadWorkflowRuntime, applyWorkflowTransition, resolveWorkflowActions } from '../services/workflowService.js';
import { computeFlashState } from '../services/offerService.js';
import { validateCheckout, submitOrder } from '../services/orderService.js';
import { buildWhatsAppInvoice, formatMoney, formatStatus, persistInvoices } from '../services/invoiceService.js';
import { appendBehaviorEvent, writeUiEvent } from '../services/analyticsService.js';
import { shellTemplate } from '../layout/shell.js';
import { renderHeader } from '../layout/header.js';
import { renderSearchBar } from '../layout/searchBar.js';
import { renderBanner } from '../layout/banner.js';
import { renderThemeSwitcher, AVAILABLE_THEMES } from '../layout/themeSwitcher.js';
import { renderHero } from '../layout/hero.js';
import { renderFooter } from '../layout/footer.js';
import { renderLoginModal, renderCustomerModal, renderProductModal, renderInvoiceModal } from '../layout/modals.js';
import { renderDrawer, renderToasts } from '../layout/overlays.js';
import { renderHomePage } from '../pages/homePage.js';
import { renderSalesManagerPage } from '../pages/salesManagerPage.js';
import { renderSearchPage } from '../pages/searchPage.js';
import { renderCompaniesPage, renderCompanyPage } from '../pages/companiesPage.js';
import { renderOffersPage } from '../pages/offersPage.js';
import { renderTiersPage } from '../pages/tiersPage.js';
import { renderCartPage, renderCheckoutPage, renderInvoicePage } from '../pages/cartCheckoutPages.js';
import { renderLoginPage, renderRegisterPage } from '../pages/authPages.js';
import { renderCustomersPage, renderInvoicesPage, renderAccountPage } from '../pages/customerPages.js';
import { storageKeys, removeValue, purgeLegacyStorage, loadJSON } from '../core/storage.js';

function createInitialData() {
  return createInitialState();
}

function createEmptyCatalog() {
  return {
    companies: [],
    products: [],
    productIndex: {},
    offers: { daily: [], flash: [] },
    tiers: [],
    settings: [],
    settingsMap: {},
    top: { products: [], companies: [] },
    counters: { companies: 0, tiers: 0, deals: 0, flash: 0 },
    catalogProducts: [],
    invoiceItemsById: {},
  };
}

const SEARCH_DEBOUNCE_MS = 900;

const RUNTIME_PHASES = {
  BOOTING: 'booting',
  RESTORING_SESSION: 'restoring_session',
  RESOLVING_AUTHORITY: 'resolving_authority',
  HYDRATING_RUNTIME: 'hydrating_runtime',
  SYNCING_CART: 'syncing_cart',
  READY: 'runtime_ready',
  FAILED: 'runtime_failed',
};

const companyHydrationTokens = new Map();

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isNonEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function cloneCatalogSnapshot(catalog) {
  const safe = catalog && typeof catalog === 'object' ? catalog : {};
  return {
    ...createEmptyCatalog(),
    ...safe,
    offers: {
      daily: Array.isArray(safe.offers?.daily) ? safe.offers.daily : [],
      flash: Array.isArray(safe.offers?.flash) ? safe.offers.flash : [],
    },
    top: {
      products: Array.isArray(safe.top?.products) ? safe.top.products : [],
      companies: Array.isArray(safe.top?.companies) ? safe.top.companies : [],
    },
  };
}

function mergeCatalogSnapshots(cachedCatalog, liveCatalog) {
  const cached = cloneCatalogSnapshot(cachedCatalog);
  const live = cloneCatalogSnapshot(liveCatalog);
  const mergedCompanies = isNonEmptyArray(live.companies) ? live.companies : cached.companies;
  const mergedProducts = isNonEmptyArray(live.products) ? live.products : cached.products;
  const mergedProductIndex = isNonEmptyObject(live.productIndex) ? live.productIndex : cached.productIndex;
  const mergedDaily = isNonEmptyArray(live.offers.daily) ? live.offers.daily : cached.offers.daily;
  const mergedFlash = isNonEmptyArray(live.offers.flash) ? live.offers.flash : cached.offers.flash;
  const mergedTiers = isNonEmptyArray(live.tiers) ? live.tiers : cached.tiers;
  const mergedSettings = isNonEmptyArray(live.settings) ? live.settings : cached.settings;
  const mergedSettingsMap = isNonEmptyObject(live.settingsMap) ? live.settingsMap : cached.settingsMap;
  const mergedTopProducts = isNonEmptyArray(live.top.products) ? live.top.products : cached.top.products;
  const mergedTopCompanies = isNonEmptyArray(live.top.companies) ? live.top.companies : cached.top.companies;
  const mergedCatalogProducts = isNonEmptyArray(live.catalogProducts) ? live.catalogProducts : cached.catalogProducts;

  return {
    companies: mergedCompanies,
    products: mergedProducts,
    productIndex: mergedProductIndex,
    offers: { daily: mergedDaily, flash: mergedFlash },
    tiers: mergedTiers,
    settings: mergedSettings,
    settingsMap: mergedSettingsMap,
    top: { products: mergedTopProducts, companies: mergedTopCompanies },
    counters: {
      companies: mergedCompanies.length,
      tiers: mergedTiers.length,
      deals: mergedDaily.length,
      flash: mergedFlash.length,
    },
    catalogProducts: mergedCatalogProducts,
    invoiceItemsById: {},
  };
}

function catalogHasMeaningfulData(catalog) {
  return Boolean(catalog)
    && (
      isNonEmptyArray(catalog.products)
      || isNonEmptyArray(catalog.companies)
      || isNonEmptyArray(catalog.tiers)
      || isNonEmptyArray(catalog.catalogProducts)
      || isNonEmptyArray(catalog.top?.products)
      || isNonEmptyArray(catalog.top?.companies)
      || isNonEmptyArray(catalog.settings)
      || isNonEmptyArray(catalog.offers?.daily)
      || isNonEmptyArray(catalog.offers?.flash)
    );
}

function isRuntimeInteractive(state) {
  return [RUNTIME_PHASES.READY, RUNTIME_PHASES.FAILED].includes(state?.runtime?.lifecycle?.phase);
}

function setRuntimeLifecycle(store, patch) {
  const current = store.getState();
  store.patch({
    runtime: {
      ...current.runtime,
      lifecycle: {
        ...current.runtime.lifecycle,
        ...patch,
      },
    },
  }, { silent: true });
}

function setRuntimePhase(store, phase, extras = {}) {
  const current = store.getState();
  store.patch({
    runtime: {
      ...current.runtime,
      lifecycle: {
        ...current.runtime.lifecycle,
        phase,
        ...extras,
      },
    },
  }, { silent: true });
}

function findCartProductItem(cart, productId) {
  return (cart || []).find((item) => item.type === 'product' && String(item.id) === String(productId));
}

function captureSearchFocus() {
  const active = document.activeElement;
  if (!active) return null;
  if (active.id === 'searchInput' || active.classList?.contains('searchbar-input')) {
    return {
      id: active.id || (active.classList?.contains('searchbar-input') ? 'searchInput' : null),
      selectionStart: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
      selectionEnd: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
      value: active.value,
    };
  }
  return null;
}

function restoreSearchFocus(snapshot) {
  if (!snapshot?.id) return;
  const input = document.getElementById(snapshot.id);
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
    if (Number.isInteger(snapshot.selectionStart) && Number.isInteger(snapshot.selectionEnd) && typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  } catch {
    // ignore focus restoration failures
  }
}

const toastTimers = new Map();
let schedulerRef = null;
let searchTypingTimer = null;

function notify(store, type, title, message, options = {}) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const queue = store.getState().ui.toastQueue.slice();
  queue.push({ id, type, title, message, icon: options.icon || { success: '✓', warning: '!', error: '×', info: 'i' }[type] || '•', action: options.action || null });
  while (queue.length > 4) queue.shift();
  store.patch({ ui: { ...store.getState().ui, toastQueue: queue } });
  if (schedulerRef) schedulerRef.schedule('toast');
  const duration = Math.max(1800, Number(options.duration || 3400));
  clearTimeout(toastTimers.get(id));
  toastTimers.set(id, setTimeout(() => {
    const next = store.getState().ui.toastQueue.filter((item) => item.id !== id);
    store.patch({ ui: { ...store.getState().ui, toastQueue: next } });
    if (schedulerRef) schedulerRef.schedule('toast');
    toastTimers.delete(id);
  }, duration));
}

const DEFAULT_THEME = 'premium-dark';
const THEME_NAMES = new Set([DEFAULT_THEME, ...AVAILABLE_THEMES.map((theme) => theme.name)]);

function setTheme(theme) {
  const next = THEME_NAMES.has(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = next;
}

function closeTransientSurfaces(store, { keepDrawer = false } = {}) {
  const current = store.getState();
  store.patch({
    ui: {
      ...current.ui,
      accountMenuOpen: false,
      activeModal: null,
      selectedInvoiceId: null,
      drawerOpen: keepDrawer ? current.ui.drawerOpen : false,
    },
  });
}

function setPendingFlow(store, flow = null) {
  const current = store.getState();
  store.patch({ ui: { ...current.ui, pendingFlow: flow } });
}

function clearPendingFlow(store) {
  setPendingFlow(store, null);
}

function navigateAuthority(store, routeName, params = {}, options = {}) {
  closeTransientSurfaces(store, { keepDrawer: Boolean(options.keepDrawer) });
  navigate(routeName, params);
}

function setCheckoutBusy(store, value) {
  const current = store.getState();
  store.patch({ ui: { ...current.ui, checkoutBusy: Boolean(value) } });
}

function resetCustomerLocationDraft(store) {
  const current = store.getState();
  store.patch({
    ui: {
      ...current.ui,
      customerLocationBusy: false,
      customerLocationError: null,
      customerLocationDraft: { text: '', lat: null, lng: null },
    },
  });
}

function commitCustomerLocationDraft(store, draft = {}) {
  const current = store.getState();
  store.patch({
    ui: {
      ...current.ui,
      customerLocationBusy: false,
      customerLocationError: null,
      customerLocationDraft: {
        text: String(draft.text || '').trim(),
        lat: draft.lat === null || draft.lat === undefined || draft.lat === '' ? null : Number(draft.lat),
        lng: draft.lng === null || draft.lng === undefined || draft.lng === '' ? null : Number(draft.lng),
      },
    },
  });
}

function rebuildLoadedCompanyCatalog(store, selectedTierOverride = null) {
  const state = store.getState();
  const selectedTier = normalizeTierName(selectedTierOverride ?? state.commerce.selectedTier);
  const caches = state.runtime.companyRowsCache || {};
  const nextIndex = { ...(state.commerce.catalog.productIndex || {}) };
  for (const rows of Object.values(caches)) {
    const aggregated = aggregateRuntimeProducts(rows);
    const projected = projectRuntimeProducts(aggregated, selectedTier);
    Object.assign(nextIndex, projected);
  }
  const products = Object.values(nextIndex).sort((a, b) => {
    const left = Number(a.units?.[a.defaultUnit]?.display_order ?? Number.POSITIVE_INFINITY);
    const right = Number(b.units?.[b.defaultUnit]?.display_order ?? Number.POSITIVE_INFINITY);
    if (left !== right) return left - right;
    return String(a.product_name).localeCompare(String(b.product_name), 'ar');
  });
  return { productIndex: nextIndex, products, priceBook: buildPriceBook(products, state.commerce.catalog.tiers || [], selectedTier) };
}

function sortLoadedProducts(productIndex) {
  return Object.values(productIndex || {}).filter((row) => row && row.visible !== false).sort((a, b) => {
    const left = Number(a.units?.[a.defaultUnit]?.display_order ?? Number.POSITIVE_INFINITY);
    const right = Number(b.units?.[b.defaultUnit]?.display_order ?? Number.POSITIVE_INFINITY);
    if (left !== right) return left - right;
    return String(a.product_name).localeCompare(String(b.product_name), 'ar');
  });
}

function buildLoadedProductSnapshot(productIndex, tiers, selectedTier) {
  const products = sortLoadedProducts(productIndex);
  return {
    productIndex: { ...(productIndex || {}) },
    products,
    priceBook: buildPriceBook(products, tiers || [], selectedTier),
  };
}

function mergeProductIndexes(...parts) {
  return Object.assign({}, ...parts.filter(Boolean));
}

async function ensureCompanyCatalogLoaded(store, api, companyId) {
  const trimmed = String(companyId ?? '').trim();
  if (!trimmed) return;
  const requestToken = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  companyHydrationTokens.set(trimmed, requestToken);
  store.update((draft) => {
    draft.runtime.loading.company = trimmed;
    draft.runtime.companyErrors[trimmed] = null;
    draft.runtime.lifecycle.companyProductsLoading = true;
    draft.runtime.lifecycle.companyProductsReady = false;
    draft.runtime.lifecycle.companyProductsFailed = false;
  }, { dirty: ['page'] });

  const cachedRows = store.getState().runtime.companyRowsCache?.[trimmed];
  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    store.update((draft) => {
      draft.runtime.companyRowsCache[trimmed] = cachedRows;
      const rebuilt = rebuildLoadedCompanyCatalog({ getState: () => draft });
      draft.commerce.catalog.productIndex = rebuilt.productIndex;
      draft.commerce.catalog.products = rebuilt.products;
      draft.commerce.priceBook = rebuilt.priceBook;
      draft.runtime.lifecycle.companyProductsReady = true;
      draft.runtime.lifecycle.companyProductsLoading = true;
      draft.runtime.lifecycle.companyProductsFailed = false;
      draft.runtime.companyErrors[trimmed] = null;
      draft.commerce.cart = syncCartPrices(draft.commerce.cart, draft.commerce.catalog.productIndex);
    }, { dirty: ['page', 'drawer', 'modals', 'header'] });
    persistCart(store.getState().commerce.cart);
  }

  try {
    const companyCatalog = await loadCompanyCatalog(api, trimmed, store.getState().commerce.selectedTier || null);
    if (companyHydrationTokens.get(trimmed) !== requestToken) return;
    const rows = Array.isArray(companyCatalog.rows) ? companyCatalog.rows : [];
    if (rows.length > 0) {
      store.update((draft) => {
        draft.runtime.companyRowsCache[trimmed] = rows;
        const rebuilt = rebuildLoadedCompanyCatalog({ getState: () => draft });
        draft.commerce.catalog.productIndex = rebuilt.productIndex;
        draft.commerce.catalog.products = rebuilt.products;
        draft.commerce.priceBook = rebuilt.priceBook;
        draft.runtime.companyErrors[trimmed] = null;
        draft.runtime.lifecycle.companyProductsReady = true;
        draft.runtime.lifecycle.companyProductsLoading = false;
        draft.runtime.lifecycle.companyProductsFailed = false;
        draft.commerce.cart = syncCartPrices(draft.commerce.cart, draft.commerce.catalog.productIndex);
      }, { dirty: ['page', 'drawer', 'modals', 'header'] });
      persistCart(store.getState().commerce.cart);
      return;
    }

    store.update((draft) => {
      draft.runtime.loading.company = null;
      draft.runtime.companyErrors[trimmed] = null;
      draft.runtime.lifecycle.companyProductsReady = Boolean(cachedRows && cachedRows.length > 0);
      draft.runtime.lifecycle.companyProductsLoading = false;
      draft.runtime.lifecycle.companyProductsFailed = false;
    }, { dirty: ['page'] });
    return;
  } catch (error) {
    if (companyHydrationTokens.get(trimmed) !== requestToken) return;
    const fallbackRows = Array.isArray(cachedRows) ? cachedRows : [];
    if (fallbackRows.length) {
      store.update((draft) => {
        draft.runtime.companyRowsCache[trimmed] = fallbackRows;
        const rebuilt = rebuildLoadedCompanyCatalog({ getState: () => draft });
        draft.commerce.catalog.productIndex = rebuilt.productIndex;
        draft.commerce.catalog.products = rebuilt.products;
        draft.commerce.priceBook = rebuilt.priceBook;
        draft.runtime.loading.company = null;
        draft.runtime.companyErrors[trimmed] = null;
        draft.runtime.lifecycle.companyProductsReady = true;
        draft.runtime.lifecycle.companyProductsLoading = false;
        draft.runtime.lifecycle.companyProductsFailed = false;
        draft.commerce.cart = syncCartPrices(draft.commerce.cart, draft.commerce.catalog.productIndex);
      }, { dirty: ['page', 'drawer', 'modals', 'header'] });
      persistCart(store.getState().commerce.cart);
      return;
    }
    store.update((draft) => {
      draft.runtime.loading.company = null;
      draft.runtime.companyErrors[trimmed] = error?.message || 'تعذر تحميل منتجات الشركة';
      draft.runtime.lifecycle.companyProductsReady = false;
      draft.runtime.lifecycle.companyProductsLoading = false;
      draft.runtime.lifecycle.companyProductsFailed = true;
    }, { dirty: ['page'] });
    return;
  }
}

function bootstrapShell(root) {
  root.innerHTML = shellTemplate();
}

function getNodes() {
  return {
    header: dom.q('#appHeader'),
    search: dom.q('#appSearch'),
    banner: dom.q('#appBanner'),
    theme: dom.q('#appTheme'),
    hero: dom.q('#appHero'),
    page: dom.q('#appPage'),
    footer: dom.q('#appFooter'),
    opsNav: dom.q('#appOpsNav'),
    drawerHost: dom.q('#appDrawerHost'),
    modalHost: dom.q('#appModalHost'),
    toastHost: dom.q('#appToastHost'),
  };
}

function isOperationalRoute(routeName) {
  return routeName === 'ops' || routeName === 'sales-manager';
}

function renderPage(state, nodes) {
  const route = state.app.route;
  const operationalRoute = isOperationalRoute(route.name);
  const tier = getSelectedTier(state);

  renderHeader(nodes.header, state);

  if (operationalRoute) {
    nodes.opsNav.innerHTML = renderOpsNavigation(state);
    nodes.banner.innerHTML = '';
    nodes.theme.innerHTML = '';
    nodes.hero.innerHTML = '';
    nodes.search.innerHTML = '';
    nodes.footer.innerHTML = '';
  } else {
    nodes.opsNav.innerHTML = '';
    renderBanner(nodes.banner, state);
    renderThemeSwitcher(nodes.theme, state);
    renderHero(nodes.hero, state, { mode: route.name === 'home' ? 'home' : 'none' });
    renderSearchBar(nodes.search, state, { routeName: route.name, show: false });
    renderFooter(nodes.footer, state);
  }

  let pageHtml = '';
  switch (route.name) {
    case 'home': pageHtml = renderHomePage(state); break;
    case 'companies': pageHtml = renderCompaniesPage(state); break;
    case 'company': pageHtml = renderCompanyPage(state); break;
    case 'offers': pageHtml = renderOffersPage(state); break;
    case 'tiers': pageHtml = renderTiersPage(state); break;
    case 'cart': pageHtml = renderCartPage(state); break;
    case 'checkout': pageHtml = renderCheckoutPage(state); break;
    case 'login': pageHtml = renderLoginPage(state); break;
    case 'register': pageHtml = renderRegisterPage(state); break;
    case 'customers': pageHtml = renderCustomersPage(state); break;
    case 'invoices': pageHtml = renderInvoicesPage(state); break;
    case 'invoice': pageHtml = renderInvoicePage(state); break;
    case 'account': pageHtml = renderAccountPage(state); break;
    case 'search': pageHtml = renderSearchPage(state); break;
    case 'ops':
    case 'sales-manager': pageHtml = renderSalesManagerPage(state); break;
    default: pageHtml = renderHomePage(state); break;
  }
  nodes.page.innerHTML = pageHtml;

  const activeProduct = state.ui.activeProduct ? state.commerce.catalog.productIndex[state.ui.activeProduct] : null;
  nodes.modalHost.innerHTML = [renderLoginModal(state), renderCustomerModal(state), renderProductModal(state, activeProduct)].join('');
  nodes.drawerHost.innerHTML = renderDrawer(state);
  nodes.toastHost.innerHTML = renderToasts(state);

  applyShellVisibility(route, nodes);
  syncBodyShellHeight();
}

function applyShellVisibility(route, nodes) {
  const operationalRoute = isOperationalRoute(route.name);
  nodes.banner.classList.toggle('is-hidden', operationalRoute);
  nodes.search.classList.toggle('is-hidden', operationalRoute || route.name !== 'search');
  nodes.hero.classList.toggle('is-hidden', operationalRoute || route.name !== 'home');
  nodes.footer.classList.toggle('is-hidden', operationalRoute);
}

function syncBodyShellHeight() {
  const footer = dom.q('#appFooter');
  const height = footer ? Math.ceil(footer.getBoundingClientRect().height || 0) : 0;
  document.documentElement.style.setProperty('--footer-height', `${height}px`);
}

function bindInteractions(store, api, schedule) {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action], [data-modal], [data-close]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const state = store.getState();
    const tier = getSelectedTier(state);

    if (action === 'navigate-home') return navigateAuthority(store, 'home');
    if (action === 'go-companies') return navigateAuthority(store, 'companies');
    if (action === 'go-offers') return navigateAuthority(store, 'offers');
    if (action === 'go-tiers') return navigateAuthority(store, 'tiers');
    if (action === 'go-search') return navigateAuthority(store, 'search');
    if (action === 'go-back') { if (history.length > 1) history.back(); else navigateAuthority(store, 'home'); return; }
    if (action === 'go-cart') { store.patch({ ui: { ...store.getState().ui, drawerOpen: false } }); schedule('drawer', 'header', 'page'); return; }
    if (action === 'go-checkout') {
      if (isSalesRepSession(state.auth.session) && !state.auth.selectedCustomer) {
        setPendingFlow(store, { name: 'checkout', resumeRoute: 'checkout', resumeMessage: 'يرجى مراجعة تفاصيل الطلب قبل الإرسال' });
        notify(store, 'warning', 'يجب اختيار العميل أولًا', 'اختر العميل ثم ستنتقل مباشرة إلى مراجعة الطلب');
        return navigateAuthority(store, 'customers');
      }
      return navigateAuthority(store, 'checkout');
    }
    if (action === 'go-login') return navigateAuthority(store, 'login');
    if (action === 'go-register') return navigateAuthority(store, 'register');
    if (action === 'go-customers') return navigateAuthority(store, 'customers');
    if (action === 'go-invoices') return navigateAuthority(store, 'invoices');
    if (action === 'go-account') return navigateAuthority(store, 'account');
    if (action === 'go-ops') {
      if (!hasOperationalAccess(state.auth.session) && !canAccessOperationalDashboard(state.auth.session)) {
        notify(store, 'warning', 'غير مصرح', 'هذه اللوحة متاحة للحسابات التشغيلية فقط');
        return;
      }
      return navigateAuthority(store, 'ops', { module: getDefaultOperationalModule(state.auth.session) });
    }
    if (action === 'go-ops-module') {
      const module = String(target.getAttribute('data-module') || '').trim() || getDefaultOperationalModule(state.auth.session);
      if (!hasOperationalAccess(state.auth.session) && !canAccessOperationalDashboard(state.auth.session)) {
        notify(store, 'warning', 'غير مصرح', 'هذه اللوحة متاحة للحسابات التشغيلية فقط');
        return;
      }
      if (!isOperationalModuleReady(module)) {
        notify(store, 'info', 'قريبًا', 'هذه الوحدة لم تُفعَّل بعد');
        return;
      }
      return navigateAuthority(store, 'ops', { module });
    }
    if (action === 'pwa-install') {
      closeTransientSurfaces(store, { keepDrawer: false });
      const pwa = window.__ALAHRAM_PWA__ || {};
      if (pwa.installed) {
        notify(store, 'info', 'التطبيق مثبت بالفعل', 'يمكنك استخدامه من الشاشة الرئيسية أو المتصفح');
        return;
      }
      if (pwa.deferredPrompt && typeof pwa.deferredPrompt.prompt === 'function') {
        const promptEvent = pwa.deferredPrompt;
        pwa.deferredPrompt = null;
        pwa.installAvailable = false;
        try {
          promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice?.outcome === 'accepted') {
            pwa.installed = true;
            notify(store, 'success', 'تم تثبيت التطبيق', 'يمكنك الآن استخدامه كتطبيق مستقل');
          } else {
            notify(store, 'info', 'تم إلغاء التثبيت', '');
          }
        } catch (error) {
          console.error(error);
          notify(store, 'warning', 'تعذر تثبيت التطبيق', 'حاول مرة أخرى من قائمة المتصفح');
        }
        return;
      }
      notify(store, 'info', 'تثبيت التطبيق', 'استخدم قائمة المتصفح أو افتح التطبيق من الشاشة الرئيسية');
      return;
    }

    if (action === 'go-flash') return navigateAuthority(store, 'offers');
    if (action === 'clear-search') { store.patch({ ui: { ...state.ui, search: '' } }); clearTimeout(searchTypingTimer); schedule('header', 'theme', 'banner', 'hero', 'page', 'search'); return; }
    if (action === 'set-theme') {
      const nextTheme = String(target.getAttribute('data-theme') || '').trim();
      if (!THEME_NAMES.has(nextTheme)) return;
      store.patch({ ui: { ...state.ui, theme: nextTheme } });
      saveJSON(storageKeys.theme, nextTheme);
      setTheme(nextTheme);
      scheduler.schedule('theme', 'header', 'banner', 'search', 'hero', 'page', 'footer');
      return;
    }
    if (action === 'toggle-account-menu') { store.patch({ ui: { ...state.ui, accountMenuOpen: !state.ui.accountMenuOpen, activeModal: null } }); schedule('header', 'modals'); return; }
    if (action === 'open-cart-drawer') { closeTransientSurfaces(store, { keepDrawer: false }); store.patch({ ui: { ...store.getState().ui, drawerOpen: true } }); schedule('drawer', 'header', 'modals'); return; }
    if (action === 'close-cart-drawer') { store.patch({ ui: { ...state.ui, drawerOpen: false } }); schedule('drawer'); return; }
    if (action === 'open-customer-modal') { closeTransientSurfaces(store, { keepDrawer: false }); resetCustomerLocationDraft(store); store.patch({ ui: { ...store.getState().ui, activeModal: 'customer' } }); schedule('modals', 'header'); return; }
    if (action === 'close-modal') { store.patch({ ui: { ...state.ui, activeModal: null, selectedInvoiceId: null, customerLocationBusy: false, customerLocationError: null, customerLocationDraft: { text: '', lat: null, lng: null } } }); schedule('modals'); return; }
    if (action === 'workflow-transition') {
      const orderId = String(target.getAttribute('data-order-id') || '').trim();
      const nextStateKey = String(target.getAttribute('data-next-state-key') || '').trim();
      const session = state.auth.session;
      const managerOrders = state.runtime?.manager?.teamOrders || [];
      const invoiceOrders = state.commerce?.invoices || [];
      const order = [...managerOrders, ...invoiceOrders].find((item) => String(item.id) === orderId);
      if (!order) {
        notify(store, 'warning', 'الطلب غير متاح', '');
        return;
      }
      const workflow = resolveWorkflowActions(order, session);
      const transition = workflow.executableTransitions.find((item) => item.to_state_key === nextStateKey);
      if (!transition) {
        notify(store, 'warning', 'لا توجد صلاحية كافية', '');
        return;
      }
      try {
        const updated = await applyWorkflowTransition(api, orderId, nextStateKey);
        const nextOrder = updated && updated.id ? updated : { ...order, workflow_state_key: nextStateKey };
        store.update((draft) => {
          if (Array.isArray(draft.runtime?.manager?.teamOrders)) {
            draft.runtime.manager.teamOrders = draft.runtime.manager.teamOrders.map((item) => String(item.id) === orderId ? { ...item, workflow_state_key: nextStateKey } : item);
            draft.runtime.manager.summary = draft.runtime.manager.summary || {};
          }
          if (Array.isArray(draft.commerce?.invoices)) {
            draft.commerce.invoices = draft.commerce.invoices.map((item) => String(item.id) === orderId ? { ...item, workflow_state_key: nextStateKey } : item);
          }
        }, { dirty: ['page', 'header', 'opsNav', 'drawer', 'modals'] });
        notify(store, 'success', 'تم تحديث الحالة', `${workflow.currentStateLabel} → ${transition.to_state_label || nextStateKey}`);
        if (hasOperationalAccess(session)) {
          void loadManagerScopeIntoState(store, api, session, { force: true }).catch(console.error);
        }
        schedule('page', 'header', 'opsNav', 'drawer', 'modals', 'toast');
        return nextOrder;
      } catch (error) {
        console.error(error);
        notify(store, 'error', 'تعذر تحديث الحالة', '');
      }
      return;
    }
    if (action === 'capture-customer-location') {
      const form = target.closest('form');
      const currentUi = store.getState().ui;
      if (!form) return;
      if (!navigator.geolocation) {
        commitCustomerLocationDraft(store, { text: currentUi.customerLocationDraft?.text || '', lat: currentUi.customerLocationDraft?.lat ?? null, lng: currentUi.customerLocationDraft?.lng ?? null });
        store.patch({ ui: { ...store.getState().ui, customerLocationBusy: false, customerLocationError: 'المتصفح لا يدعم تحديد الموقع' } });
        notify(store, 'warning', 'تعذر تحديد الموقع', 'المتصفح لا يدعم geolocation');
        schedule('modals');
        return;
      }
      store.patch({ ui: { ...store.getState().ui, customerLocationBusy: true, customerLocationError: null } });
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = Number(position?.coords?.latitude);
          const lng = Number(position?.coords?.longitude);
          const text = Number.isFinite(lat) && Number.isFinite(lng)
            ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
            : '';
          commitCustomerLocationDraft(store, { text, lat, lng });
          const formNode = form;
          if (formNode?.location) formNode.location.value = text;
          if (formNode?.location_lat) formNode.location_lat.value = Number.isFinite(lat) ? String(lat) : '';
          if (formNode?.location_lng) formNode.location_lng.value = Number.isFinite(lng) ? String(lng) : '';
          schedule('modals');
        },
        (error) => {
          const message = error?.code === 1
            ? 'تم رفض إذن الموقع'
            : error?.code === 2
              ? 'تعذر الوصول إلى الموقع'
              : error?.code === 3
                ? 'انتهت مهلة تحديد الموقع'
                : 'تعذر تحديد الموقع الحالي';
          store.patch({ ui: { ...store.getState().ui, customerLocationBusy: false, customerLocationError: message } });
          notify(store, 'warning', 'تعذر تحديد الموقع', message);
          schedule('modals');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
      return;
    }

    if (action === 'open-company') {
      const companyId = target.getAttribute('data-company-id');
      navigateAuthority(store, 'company', { companyId });
      void ensureCompanyCatalogLoaded(store, api, companyId);
      return;
    }

    if (action === 'select-customer') {
      const customerId = target.getAttribute('data-customer-id');
      const customer = (state.commerce.customers || []).find((item) => String(item.id) === String(customerId));
      if (!customer) return;
      store.update((draft) => {
        draft.auth.selectedCustomer = customer;
        draft.ui.activeModal = null;
        draft.ui.accountMenuOpen = false;
      }, { action: 'customer-select', dirty: ['page', 'header', 'modals'] });
      persistSelectedCustomer(customer);
      notify(store, 'success', 'تم اختيار العميل', customer.name || '');
      const pendingFlow = store.getState().ui.pendingFlow;
      if (pendingFlow?.name === 'checkout') {
        clearPendingFlow(store);
        notify(store, 'info', 'يرجى مراجعة تفاصيل الطلب قبل الإرسال', '');
        return navigateAuthority(store, 'checkout');
      }
      schedule('page', 'header', 'modals');
      return;
    }

    if (action === 'set-unit') {
      const productId = target.getAttribute('data-product-id');
      const unit = target.getAttribute('data-unit');
      store.update((draft) => { draft.commerce.unitPrefs[productId] = unit; draft.commerce.cart = syncCartPrices(draft.commerce.cart, draft.commerce.catalog.productIndex); }, { action: 'set-unit' });
      schedule('page', 'header', 'drawer');
      return;
    }

    if (action === 'toggle-product') {
      const productId = target.getAttribute('data-product-id');
      const product = state.commerce.catalog.productIndex[productId];
      if (!product) return;
      const quantity = Number(document.querySelector(`[data-role="product-qty"][data-product-id="${CSS.escape(productId)}"]`)?.value || state.commerce.qtyPrefs[productId] || 1);
      const result = addProductToCart(state.commerce.cart, product, tier, state.commerce.unitPrefs[productId], quantity);
      store.update((draft) => {
        draft.commerce.cart = result.cart;
        draft.commerce.qtyPrefs[productId] = Math.max(1, Number(quantity || 1));
      }, { action: 'cart-toggle' });
      persistCart(result.cart);
      notify(store, result.added ? 'success' : 'info', result.added ? 'تمت الإضافة' : 'تمت الإزالة', product.product_name);
      appendBehaviorEvent(result.added ? 'cart.add' : 'cart.remove', { productId });
      schedule('header', 'banner', 'opsNav', 'page', 'drawer');
      return;
    }

    if (action === 'toggle-deal' || action === 'toggle-flash') {
      const id = Number(target.getAttribute('data-id'));
      const offers = action === 'toggle-deal' ? state.commerce.catalog.offers.daily : state.commerce.catalog.offers.flash;
      const offer = offers.find((item) => Number(item.id) === id);
      if (!offer) return;
      if (action === 'toggle-flash' && String(offer.runtime_status || offer.status || '').trim().toLowerCase() !== 'active') {
        notify(store, 'warning', 'انتهى العرض', 'لا يمكن الشراء بعد انتهاء الوقت');
        return;
      }
      const result = toggleOfferInCart(state.commerce.cart, offer, action === 'toggle-deal' ? 'deal' : 'flash');
      if (result.reason === 'OFFER_EXPIRED') {
        notify(store, 'warning', 'انتهى العرض', 'لا يمكن الشراء بعد انتهاء الوقت');
        return;
      }
      store.patch({ commerce: { ...state.commerce, cart: result.cart } });
      persistCart(result.cart);
      notify(store, result.added ? 'success' : 'info', result.added ? 'تمت الإضافة' : 'تمت الإزالة', offer.title);
      schedule('header', 'banner', 'page', 'drawer');
      return;
    }

    if (action === 'remove-item') {
      const key = target.getAttribute('data-key');
      const next = removeItem(state.commerce.cart, key);
      store.patch({ commerce: { ...state.commerce, cart: next } });
      persistCart(next);
      schedule('header', 'banner', 'page', 'drawer');
      return;
    }

    if (action === 'qty-up' || action === 'qty-down') {
      const key = target.getAttribute('data-key');
      const delta = action === 'qty-up' ? 1 : -1;
      const item = state.commerce.cart.find((row) => row.key === key);
      if (!item) return;
      const next = updateQty(state.commerce.cart, key, Number(item.qty || 1) + delta);
      store.patch({ commerce: { ...state.commerce, cart: next } });
      persistCart(next);
      schedule('header', 'banner', 'page', 'drawer');
      return;
    }

    if (action === 'product-qty-up' || action === 'product-qty-down') {
      const productId = target.getAttribute('data-product-id');
      const delta = action === 'product-qty-up' ? 1 : -1;
      const currentQty = Number(state.commerce.qtyPrefs[productId] || findCartProductItem(state.commerce.cart, productId)?.qty || 1);
      const nextQty = Math.max(1, currentQty + delta);
      const item = findCartProductItem(state.commerce.cart, productId);
      if (item) {
        const nextCart = updateQty(state.commerce.cart, item.key, nextQty);
        store.update((draft) => {
          draft.commerce.cart = nextCart;
          draft.commerce.qtyPrefs[productId] = nextQty;
        }, { action: 'product-qty-sync', dirty: ['page', 'drawer', 'header', 'modals'] });
        persistCart(nextCart);
      } else {
        store.update((draft) => {
          draft.commerce.qtyPrefs[productId] = nextQty;
        }, { action: 'product-qty-pref', silent: true });
      }
      schedule('page', 'drawer', 'header', 'modals');
      return;
    }

    if (action === 'select-tier') {
      const tierName = normalizeTierName(target.getAttribute('data-tier-name'));
      const current = getSelectedTier(state);
      const nextTier = normalizeTierName(current.tier_name) === tierName
        ? state.commerce.catalog.tiers.find((tier) => tier.is_default) || state.commerce.catalog.tiers[0]
        : state.commerce.catalog.tiers.find((tier) => normalizeTierName(tier.tier_name) === tierName);
      const selectedTier = normalizeTierName(nextTier?.tier_name || null) || null;
      const currentState = store.getState();
      const summary = await loadHomeCatalog(api, selectedTier);
      const topIds = Array.isArray(summary.top?.products) ? summary.top.products.map((row) => row?.product_id).filter(Boolean) : [];
      const topCatalog = topIds.length ? await loadProductsByIds(api, topIds, selectedTier).catch(() => ({ productIndex: {}, products: [], priceBook: buildPriceBook([], summary.tiers || [], selectedTier) })) : { productIndex: {}, products: [], priceBook: buildPriceBook([], summary.tiers || [], selectedTier) };
      const rebuiltState = { ...currentState, commerce: { ...currentState.commerce, catalog: { ...summary, productIndex: topCatalog.productIndex, products: topCatalog.products } }, runtime: currentState.runtime };
      const rebuilt = rebuildLoadedCompanyCatalog({ getState: () => rebuiltState }, selectedTier);
      const refreshedCart = recalcCart(currentState.commerce.cart, rebuilt.productIndex);
      store.update((draft) => {
        draft.commerce.selectedTier = selectedTier;
        draft.commerce.catalog = { ...draft.commerce.catalog, ...summary, top: summary.top, catalogProducts: [] };
        draft.commerce.catalog.productIndex = rebuilt.productIndex;
        draft.commerce.catalog.products = rebuilt.products;
        draft.commerce.priceBook = rebuilt.priceBook;
        draft.commerce.cart = refreshedCart;
        draft.runtime.flashState = computeFlashState((summary.offers && summary.offers.flash) || []);
        draft.runtime.lifecycle.catalogReady = true;
        draft.runtime.lifecycle.offersReady = true;
        draft.runtime.lifecycle.flashOffersReady = Boolean((summary.offers?.flash || []).length);
        draft.runtime.lifecycle.companiesReady = Boolean((summary.companies || []).length);
        draft.runtime.lifecycle.pricingReady = true;
      }, { action: 'select-tier', dirty: ['header', 'page', 'drawer', 'hero'] });
      persistSelectedTier(selectedTier);
      persistCart(refreshedCart);
      notify(store, 'success', 'تمت الشريحة', nextTier?.visible_label || 'الشريحة الرئيسية');
      schedule('header', 'banner', 'page', 'drawer', 'hero');
      return;
    }

    if (action === 'submit-checkout') {
      const validation = validateCheckout(store.getState(), getSelectedTier(store.getState()), computeCartTotals(store.getState()));
      if (!validation.ok) {
        if (validation.code === 'NO_SESSION') {
          setPendingFlow(store, { name: 'checkout', resumeRoute: 'checkout', resumeMessage: 'يرجى مراجعة تفاصيل الطلب قبل الإرسال' });
          notify(store, 'warning', 'يجب تسجيل الدخول أولًا', 'سجل الدخول ثم ستعود مباشرة إلى إتمام الطلب');
          navigateAuthority(store, 'login');
          return;
        }
        if (validation.code === 'NO_CUSTOMER') {
          setPendingFlow(store, { name: 'checkout', resumeRoute: 'checkout', resumeMessage: 'يرجى مراجعة تفاصيل الطلب قبل الإرسال' });
          notify(store, 'warning', 'يجب اختيار العميل أولًا', 'اختر العميل ثم ستعود مباشرة إلى إتمام الطلب');
          navigateAuthority(store, 'customers');
          return;
        }
        notify(store, 'warning', 'تعذر الإرسال', validation.message);
        return;
      }
      const next = await performCheckout(store, api, schedule);
      if (next) schedule('header', 'banner', 'page', 'drawer', 'modals');
      return;
    }

    if (action === 'refresh-catalog') {
      notify(store, 'info', 'جارٍ التحديث', 'تم إيقاف زر الإصلاح اليدوي');
      return;
    }

    if (action === 'refresh-invoices') {
      loadInvoicesIntoState(store, api).catch(console.error);
      schedule('page');
      return;
    }

    if (action === 'logout') {
      logout();
      persistSelectedCustomer(null);
      store.patch({
        auth: { ...state.auth, session: null, selectedCustomer: null },
        runtime: {
          ...state.runtime,
          manager: {
            loaded: false,
            loading: false,
            error: null,
            loadedAt: null,
            ownerId: null,
            module: 'sales-manager',
            modules: [],
            teamCustomers: [],
            teamReps: [],
            teamOrders: [],
            summary: {
              customers: 0,
              reps: 0,
              orders: 0,
              pending: 0,
              reviewing: 0,
              preparing: 0,
              dispatched: 0,
              delivered: 0,
              collected: 0,
              returned: 0,
              cancelled: 0,
            },
          },
        },
        ui: { ...state.ui, accountMenuOpen: false, activeModal: null, selectedInvoiceId: null, pendingFlow: null },
      });
      notify(store, 'info', 'تم الخروج', '');
      schedule('header', 'banner', 'page', 'drawer');
      navigateAuthority(store, 'home');
      return;
    }

    if (action === 'open-product') {
      const productId = target.getAttribute('data-product-id');
      closeTransientSurfaces(store, { keepDrawer: false });
      store.patch({ ui: { ...store.getState().ui, activeModal: 'product', selectedProductId: productId } });
      schedule('modals');
      return;
    }

    if (action === 'view-invoice') {
      const invoiceId = target.getAttribute('data-invoice-id');
      const invoice = (store.getState().commerce.invoices || []).find((item) => String(item.id) === String(invoiceId));
      if (!invoice) return;
      let items = store.getState().commerce.invoiceItemsById?.[String(invoiceId)] || [];
      if (!items.length) {
        items = await api.get('order_items', {
          select: 'id,order_id,product_id,type,qty,price,unit,created_at',
          order_id: `eq.${invoiceId}`,
          order: 'created_at.asc',
        }).catch(() => []);
        items = Array.isArray(items) ? items : [];
        const names = new Map(Object.values(store.getState().commerce.catalog.productIndex || {}).map((row) => [String(row.product_id), row.product_name || '']));
        items = items.map((item) => ({
          ...item,
          title: item.title || names.get(String(item.product_id)) || item.product_id,
        }));
      }
      store.update((draft) => {
        draft.ui.selectedInvoiceId = invoiceId;
        if (!draft.commerce.invoiceItemsById) draft.commerce.invoiceItemsById = {};
        draft.commerce.invoiceItemsById[String(invoiceId)] = items;
      }, { dirty: ['page', 'header', 'footer', 'modals'] });
      navigateAuthority(store, 'invoice', { invoiceId });
      schedule('page', 'header', 'footer', 'modals');
      return;
    }

    if (action === 'open-offer') {
      navigateAuthority(store, 'offers');
      return;
    }

    if (action === 'toast-action') {
      return;
    }

    if (action === 'navigate-back-home') {
      return navigateAuthority(store, 'home');
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const state = store.getState();
    if (target.id === 'searchInput') {
      store.patch({ ui: { ...state.ui, search: target.value } }, { silent: true });
      appendBehaviorEvent('search.query', { query: target.value.slice(0, 64) });
      clearTimeout(searchTypingTimer);
      searchTypingTimer = setTimeout(() => schedule('page', 'search'), SEARCH_DEBOUNCE_MS);
      return;
    }
    if (target.getAttribute('data-role') === 'product-qty') {
      const cleaned = String(target.value || '').replace(/[^0-9]/g, '');
      if (cleaned !== target.value) target.value = cleaned;
      return;
    }
    if (target.getAttribute('data-role') === 'cart-qty') {
      const key = target.getAttribute('data-key');
      const qty = Math.max(1, Number(target.value || 1));
      store.update((draft) => { draft.commerce.cart = updateQty(draft.commerce.cart, key, qty); }, { action: 'cart-qty-update', dirty: ['page', 'drawer', 'header'] });
      persistCart(store.getState().commerce.cart);
      schedule('header', 'banner', 'page', 'drawer');
      return;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-role') !== 'product-qty') return;
    const productId = target.getAttribute('data-product-id');
    const raw = String(target.value || '').replace(/[^0-9]/g, '');
    const qty = Math.max(1, Number(raw || 1));
    store.update((draft) => {
      draft.commerce.qtyPrefs[productId] = qty;
    }, { action: 'qty-update', silent: true });
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const formType = form.getAttribute('data-form');
    if (!formType) return;
    event.preventDefault();

    if (formType === 'login') {
      const identifier = String(form.identifier?.value || '').trim();
      const password = String(form.password?.value || '').trim();
      if (!identifier || !password) {
        notify(store, 'warning', 'بيانات ناقصة', 'أدخل بيانات الدخول كاملة');
        return;
      }

      const pendingFlow = store.getState().ui.pendingFlow;
      store.patch({
        auth: {
          ...store.getState().auth,
          loginBusy: true,
        },
        ui: {
          ...store.getState().ui,
          loginFeedback: null,
          activeModal: 'login',
        },
      });

      let loginSucceeded = false;
      try {
        const session = normalizeSessionRecord(await login(api, identifier, password));
        store.patch({
          auth: {
            ...store.getState().auth,
            session,
            selectedCustomer: null,
            loginBusy: false,
          },
          runtime: {
            ...store.getState().runtime,
            manager: {
              loaded: false,
              loading: false,
              error: null,
              loadedAt: null,
              ownerId: null,
              module: getDefaultOperationalModule(session),
              modules: [],
              teamCustomers: [],
              teamReps: [],
              teamOrders: [],
              summary: {
                customers: 0,
                reps: 0,
                orders: 0,
                pending: 0,
                reviewing: 0,
                preparing: 0,
                dispatched: 0,
                delivered: 0,
                collected: 0,
                returned: 0,
                cancelled: 0,
              },
            },
          },
          ui: {
            ...store.getState().ui,
            activeModal: null,
            accountMenuOpen: false,
            loginFeedback: null,
          },
        });
        persistSessionRecord(session);
        persistSelectedCustomer(null);
        notify(store, 'success', 'تم الدخول', session.name || session.username || '');
        if (isSalesRepSession(session)) {
          loadCustomersIntoState(store, api, session).catch(console.error);
        }
        if (hasOperationalAccess(session)) {
          loadManagerScopeIntoState(store, api, session).catch(console.error);
        }
        loadInvoicesIntoState(store, api).catch(console.error);
        if (pendingFlow?.name === 'checkout' && isSalesRepSession(session)) {
          setPendingFlow(store, pendingFlow);
          notify(store, 'info', 'يجب اختيار العميل أولًا', 'اختر العميل ثم ستعود مباشرة إلى إتمام الطلب');
          navigateAuthority(store, 'customers');
        } else if (pendingFlow?.name === 'checkout') {
          clearPendingFlow(store);
          notify(store, 'info', 'يرجى مراجعة تفاصيل الطلب قبل الإرسال', '');
          navigateAuthority(store, 'checkout');
        } else {
          clearPendingFlow(store);
          navigateAuthority(store, 'home');
        }
        loginSucceeded = true;
        schedule('header', 'banner', 'page', 'drawer', 'search', 'hero');
      } catch (error) {
        const persistedSession = readPersistedSession();
        if (loginSucceeded || persistedSession) {
          const recoveredSession = persistedSession || store.getState().auth.session;
          if (recoveredSession) {
            store.patch({
              auth: {
                ...store.getState().auth,
                session: recoveredSession,
                selectedCustomer: null,
                loginBusy: false,
              },
              ui: {
                ...store.getState().ui,
                activeModal: null,
                accountMenuOpen: false,
                loginFeedback: null,
              },
            });
            persistSelectedCustomer(null);
            clearPendingFlow(store);
            navigateAuthority(store, 'home');
            schedule('header', 'banner', 'page', 'drawer', 'search', 'hero', 'modals');
            return;
          }
        }
        store.patch({
          auth: {
            ...store.getState().auth,
            loginBusy: false,
          },
        });
        notify(store, 'error', 'يرجى التحقق من اسم المستخدم وكلمة المرور', '');
      }
      return;
    }

    if (formType === 'register') {
      const payload = {
        name: String(form.name?.value || '').trim(),
        phone: String(form.phone?.value || '').trim(),
        password: String(form.password?.value || '').trim(),
        address: String(form.address?.value || '').trim(),
        business_name: String(form.businessName?.value || '').trim(),
        location: String(form.location?.value || '').trim(),
      };
      if (payload.name.split(/\s+/).filter(Boolean).length < 2) return notify(store, 'warning', 'الاسم غير مكتمل', 'اكتب الاسم بالكامل');
      if (!/^01\d{9}$/.test(payload.phone)) return notify(store, 'warning', 'رقم الهاتف غير صحيح', '');
      if (payload.password.length < 4) return notify(store, 'warning', 'كلمة المرور قصيرة', '');
      if (!payload.address) return notify(store, 'warning', 'العنوان مطلوب', '');
      try {
        const pendingFlow = store.getState().ui.pendingFlow;
        const session = normalizeSessionRecord(await registerCustomer(api, payload));
        store.patch({ auth: { ...store.getState().auth, session, selectedCustomer: null }, ui: { ...store.getState().ui, activeModal: null } });
        persistSelectedCustomer(null);
        notify(store, 'success', 'تم التسجيل', session.name || '');
        if (pendingFlow?.name === 'checkout') {
          clearPendingFlow(store);
          notify(store, 'info', 'يرجى مراجعة تفاصيل الطلب قبل الإرسال', '');
          navigateAuthority(store, 'checkout');
        } else {
          clearPendingFlow(store);
          navigateAuthority(store, 'home');
        }
        schedule('header', 'banner', 'page', 'drawer', 'search', 'hero');
      } catch (error) {
        notify(store, 'error', error.message === 'DUPLICATE_PHONE' ? 'الرقم مسجل بالفعل' : 'تعذر التسجيل');
      }
      return;
    }

    if (formType === 'customer-create') {
      const session = store.getState().auth.session;
      const isManagerScope = hasCapability(session, ['sales_manager.access', 'sales_manager.assign_customers', 'dashboard.admin', 'system.manage_dashboard']);
      if (!isSalesRepSession(session) && !isManagerScope) return notify(store, 'warning', 'الحساب التشغيلي فقط', '');
      const rawLat = String(form.location_lat?.value || '').trim();
      const rawLng = String(form.location_lng?.value || '').trim();
      const ownershipActorId = getOwnershipActorId(session) || session?.system_user?.id || session?.id || '';
      const payload = {
        name: String(form.name?.value || '').trim(),
        phone: String(form.phone?.value || '').trim() || null,
        password: String(form.password?.value || '').trim() || null,
        address: String(form.address?.value || '').trim() || null,
        location: String(form.location?.value || '').trim() || null,
        location_lat: rawLat ? Number(rawLat) : null,
        location_lng: rawLng ? Number(rawLng) : null,
        customer_type: isSalesRepSession(session) ? 'rep' : 'rep',
        sales_rep_id: isSalesRepSession(session) ? ownershipActorId : null,
        created_by: session.id,
        created_by_rep_id: isSalesRepSession(session) ? ownershipActorId : null,
        owner_user_id: isManagerScope ? (session?.system_user?.id || session.id) : ownershipActorId,
        owner_user_type: isManagerScope ? 'sales_manager' : (isSalesRepSession(session) ? 'sales_rep' : 'customer'),
        owner_scope: isManagerScope ? 'sales_manager' : (isSalesRepSession(session) ? 'sales_rep' : 'customer'),
        is_active: true,
      };
      if (!payload.name) return notify(store, 'warning', 'اسم العميل مطلوب', '');
      try {
        const customer = await createCustomer(api, payload);
        store.update((draft) => {
          draft.commerce.customers = [customer, ...(draft.commerce.customers || [])];
          draft.auth.selectedCustomer = customer;
          draft.ui.activeModal = null;
          draft.ui.accountMenuOpen = false;
          draft.ui.customerLocationBusy = false;
          draft.ui.customerLocationError = null;
          draft.ui.customerLocationDraft = { text: '', lat: null, lng: null };
        });
        persistSelectedCustomer(customer);
        if (hasOperationalAccess(session)) {
          void loadManagerScopeIntoState(store, api, session, { force: true }).catch(console.error);
        }
        notify(store, 'success', 'تمت الإضافة', customer.name || '');
        const pendingFlow = store.getState().ui.pendingFlow;
        if (pendingFlow?.name === 'checkout') {
          clearPendingFlow(store);
          notify(store, 'info', 'يرجى مراجعة تفاصيل الطلب قبل الإرسال', '');
          navigateAuthority(store, 'checkout');
        } else {
          schedule('page', 'header', 'modals');
        }
      } catch {
        notify(store, 'error', 'تعذر إضافة العميل', '');
      }
      return;
    }
  });
}

async function loadInvoicesIntoState(store, api) {
  const state = store.getState();
  const session = normalizeSessionRecord(state.auth.session);
  if (!session) {
    store.update((draft) => { draft.commerce.invoices = []; draft.runtime.loading.invoices = false; });
    return;
  }

  let rows = [];
  if (isSalesRepSession(session)) {
    const ownershipActorId = getOwnershipActorId(session) || session.id;
    const customers = state.commerce.customers?.length ? state.commerce.customers : await loadRepCustomers(api, ownershipActorId).catch(() => []);
    const customerIds = Array.from(new Set((customers || []).map((customer) => String(customer.id || '').trim()).filter(Boolean)));
    const filters = [`sales_rep_id.eq.${ownershipActorId}`, `rep_id.eq.${ownershipActorId}`];
    if (customerIds.length) filters.push(`customer_id.in.(${customerIds.join(',')})`);
    rows = await api.get('orders', {
      select: 'id,order_number,invoice_number,created_at,total_amount,status,workflow_state_key,user_type,customer_id,user_id,sales_rep_id,rep_id,updated_at',
      or: `(${filters.join(',')})`,
      order: 'created_at.desc',
    }).catch(() => []);

    const customerNames = new Map((customers || []).map((customer) => [String(customer.id), customer.name || customer.phone || '']));
    rows = Array.isArray(rows) ? rows.map((row) => ({
      ...row,
      customer_name: customerNames.get(String(row.customer_id)) || row.customer_name || '',
    })) : [];
  } else {
    rows = await api.get('orders', {
      select: 'id,order_number,invoice_number,created_at,total_amount,status,workflow_state_key,user_type,customer_id,user_id,sales_rep_id,rep_id,updated_at',
      or: `(customer_id.eq.${session.id},user_id.eq.${session.id})`,
      order: 'created_at.desc',
    }).catch(() => []);
    rows = Array.isArray(rows) ? rows.map((row) => ({ ...row, customer_name: session.name || session.username || '' })) : [];
  }

  store.update((draft) => { draft.commerce.invoices = rows; draft.runtime.loading.invoices = false; });
  persistInvoices(rows);
}

async function loadCustomersIntoState(store, api, session = null) {
  const state = store.getState();
  const rep = session || state.auth.session;
  if (!isSalesRepSession(rep)) {
    store.update((draft) => { draft.commerce.customers = []; draft.runtime.loading.customers = false; });
    return;
  }
  const rows = await loadRepCustomers(api, getOwnershipActorId(rep) || rep.id);
  store.update((draft) => { draft.commerce.customers = rows; draft.runtime.loading.customers = false; });
}

async function performCheckout(store, api, schedule) {
  const state = store.getState();
  const tier = getSelectedTier(state);
  const totals = computeCartTotals(state);
  const validation = validateCheckout(state, tier, totals);
  if (!validation.ok) {
    notify(store, 'warning', 'تعذر الإرسال', validation.message);
    return false;
  }

  setCheckoutBusy(store, true);
  try {
    const result = await submitOrder(api, state, tier, totals);
    const invoice = {
      id: result.order.id,
      order_number: result.order.order_number,
      invoice_number: result.order.invoice_number,
      created_at: result.order.created_at || new Date().toISOString(),
      total_amount: result.order.total_amount,
      status: result.order.status,
      workflow_state_key: result.order.workflow_state_key || 'pending',
      user_type: result.order.user_type,
      customer_id: result.order.customer_id,
      user_id: result.order.user_id,
      sales_rep_id: result.order.sales_rep_id,
      customer_name: result.customer?.name || state.auth.selectedCustomer?.name || state.auth.session?.name || '',
    };
    const whatsappUrl = buildWhatsAppInvoice({
      order: result.order,
      items: state.commerce.cart,
      session: state.auth.session,
      customer: result.customer,
      tierLabel: tier.visible_label || tier.tier_name,
      supportWhatsapp: api.config.supportWhatsapp,
    });
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    store.update((draft) => {
      draft.commerce.cart = [];
      draft.commerce.invoices = [invoice, ...(draft.commerce.invoices || [])];
      draft.ui.drawerOpen = false;
      draft.ui.activeModal = null;
      draft.ui.accountMenuOpen = false;
      draft.ui.pendingFlow = null;
    });
    clearCart();
    persistInvoices([invoice, ...(state.commerce.invoices || [])]);
    notify(store, 'success', 'تم إرسال الطلب', `فاتورة ${invoice.order_number || invoice.invoice_number || invoice.id}`);
    appendBehaviorEvent('checkout.submit', { orderId: invoice.id, total: totals.grand });
    schedule('header', 'banner', 'page', 'drawer');
    navigateAuthority(store, 'invoices');
    return true;
  } catch (error) {
    console.error(error);
    notify(store, 'error', 'فشل إرسال الطلب', '');
    return false;
  } finally {
    setCheckoutBusy(store, false);
  }
}

export async function bootstrapApp() {
  const config = readConfig();
  const api = createApiClient(config);
  const store = createStore(createInitialData());
  store.patch({
    commerce: { ...store.getState().commerce, catalog: createEmptyCatalog() },
    runtime: { ...store.getState().runtime, companyRowsCache: {} },
  }, { silent: true });
  setTheme(store.getState().ui.theme);

  const bootState = store.getState();
  const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  setRuntimePhase(store, RUNTIME_PHASES.RESTORING_SESSION, { bootId, locked: true, error: null, sessionRestored: false, authorityResolved: false, pricingReady: false, cartSynced: false });
  const authoritativeSession = normalizeSessionRecord(bootState.auth.session);
  const authoritativeCustomer = isSalesRepSession(authoritativeSession) ? bootState.auth.selectedCustomer : null;
  store.patch({ auth: { ...bootState.auth, session: authoritativeSession, selectedCustomer: authoritativeCustomer } });
  setRuntimePhase(store, RUNTIME_PHASES.RESOLVING_AUTHORITY, { sessionRestored: true, authorityResolved: true });

  const app = document.getElementById('app');
  bootstrapShell(app);
  const nodes = getNodes();
  const scheduler = createRenderLoop({
    header: () => { if (!isRuntimeInteractive(store.getState())) return; return renderHeader(nodes.header, store.getState()); },
    theme: () => { if (!isRuntimeInteractive(store.getState())) return; nodes.theme.innerHTML = renderThemeSwitcher(store.getState()); setTheme(store.getState().ui.theme); },
    banner: () => { if (!isRuntimeInteractive(store.getState())) return; return renderBanner(nodes.banner, store.getState()); },
    search: () => { if (!isRuntimeInteractive(store.getState())) return; return renderSearchBar(nodes.search, store.getState(), { routeName: store.getState().app.route.name, show: false }); },
    hero: () => { if (!isRuntimeInteractive(store.getState())) return; return renderHero(nodes.hero, store.getState(), { mode: store.getState().app.route.name === 'home' ? 'home' : 'none' }); },
    page: () => renderContent(),
    footer: () => { if (!isRuntimeInteractive(store.getState())) return; return renderFooter(nodes.footer, store.getState()); },
    drawer: () => { if (!isRuntimeInteractive(store.getState())) return; nodes.drawerHost.innerHTML = renderDrawer(store.getState()); },
    modals: () => {
      if (!isRuntimeInteractive(store.getState())) return;
      const activeProduct = store.getState().ui.activeModal === 'product' && store.getState().ui.selectedProductId ? store.getState().commerce.catalog.productIndex[store.getState().ui.selectedProductId] : null;
      nodes.modalHost.innerHTML = [renderLoginModal(store.getState()), renderCustomerModal(store.getState()), renderProductModal(store.getState(), activeProduct), renderInvoiceModal(store.getState())].join('');
    },
    toast: () => { if (!isRuntimeInteractive(store.getState())) return; nodes.toastHost.innerHTML = renderToasts(store.getState()); },
  });

  function renderContent() {
    const state = store.getState();
    const phase = state.runtime?.lifecycle?.phase || RUNTIME_PHASES.BOOTING;
    const focusSnapshot = state.app.route.name === 'search' ? captureSearchFocus() : null;
    const booting = !isRuntimeInteractive(state);
    if (booting) {
      const message = phase === RUNTIME_PHASES.FAILED
        ? (state.app.lastError || state.runtime?.lifecycle?.error || 'تعذر تهيئة النظام')
        : 'جارٍ تهيئة البيانات…';
      nodes.page.innerHTML = `<section class="page-section"><div class="empty-state">${message}</div></section>`;
      nodes.modalHost.innerHTML = '';
      nodes.drawerHost.innerHTML = '';
      nodes.toastHost.innerHTML = '';
      nodes.theme.innerHTML = '';
      nodes.opsNav.innerHTML = '';
      setTheme(state.ui.theme);
      syncBodyShellHeight();
      applyBodyFlags();
      return;
    }
    const route = state.app.route.name;
    let html = '';
    if (route === 'home') html = renderHomePage(state);
    else if (route === 'companies') html = renderCompaniesPage(state);
    else if (route === 'company') html = renderCompanyPage(state);
    else if (route === 'offers') html = renderOffersPage(state);
    else if (route === 'tiers') html = renderTiersPage(state);
    else if (route === 'cart') html = renderCartPage(state);
    else if (route === 'checkout') html = renderCheckoutPage(state);
    else if (route === 'login') html = renderLoginPage(state);
    else if (route === 'register') html = renderRegisterPage(state);
    else if (route === 'customers') html = renderCustomersPage(state);
    else if (route === 'invoices') html = renderInvoicesPage(state);
    else if (route === 'invoice') html = renderInvoicePage(state);
    else if (route === 'account') html = renderAccountPage(state);
    else if (route === 'search') html = renderSearchPage(state);
    else if (route === 'ops' || route === 'sales-manager') html = renderSalesManagerPage(state);
    else html = renderHomePage(state);
    nodes.page.innerHTML = html;
    nodes.opsNav.innerHTML = renderOpsNavigation(state);
    nodes.modalHost.innerHTML = [renderLoginModal(state), renderCustomerModal(state), renderProductModal(state, state.ui.selectedProductId ? state.commerce.catalog.productIndex[state.ui.selectedProductId] : null)].join('');
    nodes.drawerHost.innerHTML = renderDrawer(state);
    nodes.toastHost.innerHTML = renderToasts(state);
    nodes.theme.innerHTML = renderThemeSwitcher(state);
    setTheme(state.ui.theme);
    syncBodyShellHeight();
    applyBodyFlags();
    if (focusSnapshot) restoreSearchFocus(focusSnapshot);
  }

  function applyBodyFlags() {
    const state = store.getState();
    const route = state.app.route.name;
    const drawerOpen = Boolean(state.ui.drawerOpen);
    const modalOpen = Boolean(state.ui.activeModal);
    const checkoutRoute = route === 'checkout';
    const operationalRoute = isOperationalRoute(route);
    nodes.search.classList.toggle('is-hidden', operationalRoute || route !== 'search');
    nodes.theme.classList.toggle('is-hidden', operationalRoute || route !== 'home' || checkoutRoute);
    nodes.hero.classList.toggle('is-hidden', operationalRoute || route !== 'home' || checkoutRoute);
    nodes.banner.classList.toggle('is-hidden', operationalRoute);
    nodes.footer.classList.toggle('is-hidden', operationalRoute || checkoutRoute);
    nodes.opsNav.classList.toggle('is-hidden', !operationalRoute);
    document.body.classList.toggle('body--overlay', ['login', 'register'].includes(route));
    document.body.classList.toggle('body--checkout', checkoutRoute);
    document.body.classList.toggle('body--ops', operationalRoute);
    document.body.classList.toggle('body--drawer-open', drawerOpen);
    document.body.classList.toggle('body--modal-open', modalOpen);
  }

  schedulerRef = scheduler;
  store.subscribe((_, meta = {}) => {
    const dirty = Array.isArray(meta.dirty) && meta.dirty.length ? meta.dirty : ['header', 'theme', 'search', 'hero', 'footer', 'opsNav', 'page', 'drawer', 'modals', 'toast'];
    scheduler.schedule(...dirty);
  });

  bindInteractions(store, api, (...keys) => scheduler.schedule(...keys));

  window.addEventListener('hashchange', () => {
    const current = store.getState();
    const nextRoute = parseRoute(location.hash);
    store.patch({
      app: { ...current.app, route: nextRoute },
      ui: { ...current.ui, accountMenuOpen: false, activeModal: null, drawerOpen: false },
    });
    if (nextRoute.name === 'company' && nextRoute.params?.companyId) {
      void ensureCompanyCatalogLoaded(store, api, nextRoute.params.companyId);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      store.patch({ ui: { ...store.getState().ui, drawerOpen: false, activeModal: null, accountMenuOpen: false } });
      scheduler.schedule('drawer', 'modals', 'header');
    }
  });

  window.addEventListener('resize', () => syncBodyShellHeight(), { passive: true });

  // Initial route
  store.patch({ app: { ...store.getState().app, route: parseRoute(location.hash || '#home') } });

  // Hydrate catalog and dependent runtime in the background after first paint.
  const initialRoute = store.getState().app.route;
  const initialCompanyId = initialRoute.name === 'company' ? String(initialRoute.params?.companyId || '').trim() : '';
  store.update((draft) => {
    draft.runtime.loading.catalog = true;
    draft.runtime.loading.session = false;
    draft.runtime.loading.authority = false;
    draft.runtime.loading.pricing = true;
    draft.runtime.loading.customers = false;
    draft.runtime.loading.invoices = false;
    if (initialCompanyId) {
      draft.runtime.loading.company = initialCompanyId;
      draft.runtime.lifecycle.companyProductsLoading = true;
      draft.runtime.lifecycle.companyProductsReady = false;
      draft.runtime.lifecycle.companyProductsFailed = false;
    }
  }, { silent: true });
  setRuntimePhase(store, RUNTIME_PHASES.READY, {
    locked: false,
    catalogReady: false,
    offersReady: false,
    flashOffersReady: false,
    companiesReady: false,
    pricingReady: false,
    cartSynced: false,
    companyProductsReady: Boolean(initialCompanyId ? false : store.getState().runtime.lifecycle?.companyProductsReady),
    companyProductsLoading: Boolean(initialCompanyId),
    companyProductsFailed: false,
  });

  store.update((draft) => {
    draft.runtime.loading.workflow = true;
    draft.runtime.lifecycle.workflowLoading = true;
    draft.runtime.lifecycle.workflowReady = false;
  }, { silent: true });

  void loadWorkflowRuntime(api).then((snapshot) => {
    const nextSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    store.update((draft) => {
      draft.runtime.workflow = {
        ...draft.runtime.workflow,
        ...nextSnapshot,
      };
      draft.runtime.loading.workflow = false;
      draft.runtime.lifecycle.workflowLoading = false;
      draft.runtime.lifecycle.workflowReady = Boolean(nextSnapshot.loaded);
    }, { dirty: ['opsNav', 'page', 'header'] });
    scheduler.schedule('opsNav', 'page', 'header');
  }).catch((error) => {
    console.error(error);
    store.update((draft) => {
      draft.runtime.loading.workflow = false;
      draft.runtime.lifecycle.workflowLoading = false;
      draft.runtime.lifecycle.workflowReady = false;
    }, { silent: true });
  });
  store.patch({ app: { ...store.getState().app, ready: true } });
  renderContent();
  scheduler.schedule('header', 'theme', 'banner', 'search', 'hero', 'opsNav', 'page', 'footer', 'drawer', 'modals', 'toast');
  purgeLegacyStorage();

  void (async () => {
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });

    let summary = null;
    let selectedTier = normalizeTierName(store.getState().commerce.selectedTier) || null;
    try {
      summary = await loadHomeCatalog(api, selectedTier);
      const currentState = store.getState();
      const tierFromSummary = normalizeTierName(currentState.commerce.selectedTier)
        || normalizeTierName(summary.tiers?.find((tier) => tier.is_default)?.tier_name)
        || normalizeTierName(summary.tiers?.[0]?.tier_name)
        || 'base';
      selectedTier = tierFromSummary;
      const flashState = computeFlashState((summary.offers && summary.offers.flash) || []);
      store.update((draft) => {
        draft.commerce.catalog = {
          ...draft.commerce.catalog,
          ...summary,
          products: [],
          productIndex: {},
          catalogProducts: [],
        };
        draft.commerce.selectedTier = selectedTier;
        draft.commerce.priceBook = { tierName: selectedTier, products: {} };
        draft.runtime.loading.catalog = false;
        draft.runtime.loading.pricing = true;
        draft.runtime.flashState = flashState;
        draft.runtime.lifecycle.catalogReady = true;
        draft.runtime.lifecycle.offersReady = true;
        draft.runtime.lifecycle.flashOffersReady = Boolean((summary.offers?.flash || []).length);
        draft.runtime.lifecycle.companiesReady = Boolean((summary.companies || []).length);
        draft.runtime.lifecycle.pricingReady = true;
        draft.app.lastError = null;
      }, { dirty: ['header', 'banner', 'page', 'hero', 'footer', 'search'] });
      persistSelectedTier(selectedTier);
      scheduler.schedule('header', 'theme', 'banner', 'search', 'hero', 'opsNav', 'page', 'footer', 'drawer', 'modals', 'toast');
    } catch (error) {
      console.error(error);
      summary = { companies: [], products: [], productIndex: {}, offers: { daily: [], flash: [] }, tiers: [], settings: [], settingsMap: {}, top: { products: [], companies: [] }, counters: { companies: 0, tiers: 0, deals: 0, flash: 0 }, catalogProducts: [] };
      store.update((draft) => {
        draft.commerce.catalog = { ...draft.commerce.catalog, ...summary };
        draft.runtime.loading.catalog = false;
        draft.runtime.loading.pricing = true;
        draft.runtime.lifecycle.catalogReady = true;
        draft.runtime.lifecycle.offersReady = true;
        draft.runtime.lifecycle.flashOffersReady = true;
        draft.runtime.lifecycle.companiesReady = true;
        draft.runtime.lifecycle.pricingReady = true;
        draft.app.lastError = null;
      }, { dirty: ['header', 'banner', 'page', 'hero', 'footer', 'search'] });
      scheduler.schedule('header', 'theme', 'banner', 'search', 'hero', 'opsNav', 'page', 'footer', 'drawer', 'modals', 'toast');
    }

    const tierName = normalizeTierName(selectedTier) || 'base';
    const topProductIds = Array.isArray(summary?.top?.products) ? summary.top.products.map((row) => row?.product_id).filter(Boolean) : [];
    const homeTopProducts = topProductIds.length ? await loadProductsByIds(api, topProductIds, tierName).catch(() => ({ productIndex: {}, products: [], priceBook: buildPriceBook([], summary?.tiers || [], tierName) })) : { productIndex: {}, products: [], priceBook: buildPriceBook([], summary?.tiers || [], tierName) };
    const mergedTopProducts = buildLoadedProductSnapshot(homeTopProducts.productIndex, summary?.tiers || [], tierName);

    store.update((draft) => {
      draft.commerce.catalog.productIndex = mergeProductIndexes(draft.commerce.catalog.productIndex, mergedTopProducts.productIndex);
      draft.commerce.catalog.products = sortLoadedProducts(draft.commerce.catalog.productIndex);
      draft.commerce.priceBook = buildPriceBook(draft.commerce.catalog.products, draft.commerce.catalog.tiers || [], tierName);
      draft.runtime.loading.pricing = false;
      draft.runtime.lifecycle.pricingReady = true;
    }, { dirty: ['page', 'header', 'drawer', 'modals'] });
    const currentLoadedProducts = store.getState().commerce.catalog.productIndex || {};
    const cart = hydrateCart();
    const reconciledCart = Object.keys(currentLoadedProducts).length ? recalcCart(cart, currentLoadedProducts) : cart;
    store.patch({ commerce: { ...store.getState().commerce, cart: reconciledCart } }, { silent: true });
    setRuntimeLifecycle(store, { cartSynced: true });
    persistCart(reconciledCart);
    scheduler.schedule('header', 'banner', 'opsNav', 'page', 'drawer', 'modals', 'toast');

    if (initialCompanyId) {
      void ensureCompanyCatalogLoaded(store, api, initialCompanyId).then(() => {
        const state = store.getState();
        setRuntimePhase(store, state.runtime.lifecycle.phase, {
          companyProductsReady: Boolean(state.runtime.lifecycle?.companyProductsReady),
          companyProductsLoading: false,
          companyProductsFailed: Boolean(state.runtime.lifecycle?.companyProductsFailed),
        });
      });
    }

    const session = store.getState().auth.session;
    if (isSalesRepSession(session)) {
      store.update((draft) => { draft.runtime.loading.customers = true; }, { silent: true });
      void loadCustomersIntoState(store, api, session);
    }
    if (hasOperationalAccess(session)) {
      store.update((draft) => { draft.runtime.loading.manager = true; }, { silent: true });
      void loadManagerScopeIntoState(store, api, session).catch(console.error);
    }
    store.update((draft) => { draft.runtime.loading.invoices = true; }, { silent: true });
    void loadInvoicesIntoState(store, api);
  })();

  setInterval(() => {
    const state = store.getState();
    const offers = state.commerce.catalog.offers.flash || [];
    const flashState = computeFlashState(offers);
    store.patch({ runtime: { ...state.runtime, flashState, flashTick: Date.now() } }, { dirty: ['hero', 'header'] });
    if (state.app.route.name === 'home') scheduler.schedule('hero', 'header');
  }, 1000);

  return { store, api, scheduler };
}
