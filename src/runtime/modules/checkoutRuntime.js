export function setCheckoutBusy(store, value) {
  const current = store.getState();
  store.patch({ ui: { ...current.ui, checkoutBusy: Boolean(value) } });
}

export function createCheckoutRuntimeFacade() {
  return {
    setCheckoutBusy,
  };
}
