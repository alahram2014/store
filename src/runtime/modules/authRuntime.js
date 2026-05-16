import { normalizeSessionRecord, isSalesRepSession, hasOperationalAccess, readPersistedSession } from '../../services/authService.js';

export function restoreAuthRuntimeState(authState = {}) {
  const session = normalizeSessionRecord(authState.session || readPersistedSession() || null);
  const selectedCustomer = (isSalesRepSession(session) || hasOperationalAccess(session)) ? authState.selectedCustomer || null : null;

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
