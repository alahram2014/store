import { normalizeSessionRecord, isSalesRepSession } from '../../services/authService.js';

export function restoreAuthRuntimeState(authState = {}) {
  const session = normalizeSessionRecord(authState.session || null);
  const selectedCustomer = isSalesRepSession(session) ? authState.selectedCustomer || null : null;

  return {
    session,
    selectedCustomer,
  };
}

export function createAuthRuntimeFacade() {
  return {
    restoreAuthRuntimeState,
  };
}
