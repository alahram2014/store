import { loadJSON, storageKeys } from '../core/storage.js';
import { normalizeTierName } from '../services/pricingService.js';
import { normalizeSessionRecord } from '../services/authService.js';

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
  };
}

export function createInitialState() {
  return {
    app: {
      ready: false,
      route: { name: 'home', params: {} },
      lastError: null,
    },
    ui: {
      search: '',
      drawerOpen: false,
      activeModal: null,
      accountMenuOpen: false,
      selectedProductId: null,
      selectedInvoiceId: null,
      theme: loadJSON(storageKeys.theme, 'premium-dark') || 'premium-dark',
      toastQueue: [],
      flashTick: Date.now(),
      pendingFlow: null,
      loginFeedback: null,
      customerLocationBusy: false,
      customerLocationError: null,
      customerLocationDraft: {
        text: '',
        lat: null,
        lng: null,
      },
    },
    auth: {
      session: normalizeSessionRecord(loadJSON(storageKeys.session, null)),
      selectedCustomer: loadJSON(storageKeys.selectedCustomer, null),
      loginBusy: false,
      registerBusy: false,
      checkoutBusy: false,
    },
    commerce: {
      selectedTier: normalizeTierName(loadJSON(storageKeys.tier, null)),
      unitPrefs: {},
      qtyPrefs: {},
      cart: loadJSON(storageKeys.cart, []),
      catalog: createEmptyCatalog(),
      invoices: [],
      invoiceItemsById: {},
      customers: [],
      top: { products: [], companies: [] },
      priceBook: { tierName: null, products: {} },
    },
    runtime: {
      lifecycle: {
        phase: 'booting',
        locked: true,
        bootId: null,
        error: null,
        sessionRestored: false,
        authorityResolved: false,
        catalogReady: false,
        offersReady: false,
        flashOffersReady: false,
        companiesReady: false,
        pricingReady: false,
        cartSynced: false,
        companyProductsReady: false,
        companyProductsLoading: false,
        companyProductsFailed: false,
      },
      loading: {
        catalog: false,
        company: null,
        customers: false,
        invoices: false,
        session: false,
        authority: false,
        pricing: false,
      },
      companyRowsCache: {},
      companyErrors: {},
      flashState: null,
      behavior: [],
      splashReady: false,
    },
  };
}
