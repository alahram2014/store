import { navigate } from '../../core/router.js';

export function closeTransientSurfaces(store, { keepDrawer = false } = {}) {
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

export function setPendingFlow(store, flow = null) {
  const current = store.getState();
  store.patch({ ui: { ...current.ui, pendingFlow: flow } });
}

export function clearPendingFlow(store) {
  setPendingFlow(store, null);
}

export function navigateAuthority(store, routeName, params = {}, options = {}) {
  closeTransientSurfaces(store, { keepDrawer: Boolean(options.keepDrawer) });
  navigate(routeName, params);
}

export function resetCustomerLocationDraft(store) {
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

export function commitCustomerLocationDraft(store, draft = {}) {
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

export function createNavigationRuntimeFacade() {
  return {
    closeTransientSurfaces,
    setPendingFlow,
    clearPendingFlow,
    navigateAuthority,
    resetCustomerLocationDraft,
    commitCustomerLocationDraft,
  };
}
