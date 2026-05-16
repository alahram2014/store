import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { publishDomainEvent } from './domainEventService.js';

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim();
}

export function normalizeUserType(value, fallback = null) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'rep' || raw === 'sales_rep' || raw === 'sales rep' || raw === 'sales-rep') return 'sales_rep';
  if (raw === 'sales_manager' || raw === 'sales manager') return 'sales_manager';
  if (raw === 'admin') return 'admin';
  if (raw === 'customer' || raw === 'direct') return 'customer';
  return fallback;
}

export function normalizeCapabilityList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry.trim();
      if (typeof entry === 'object') return normalizeIdentifier(entry.capability_key || entry.key || entry.name || '');
      return '';
    }).filter(Boolean)));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean)));
  }
  return [];
}

export function normalizeSessionRecord(session) {
  if (!session || typeof session !== 'object') return null;
  const explicit = session.userType || session.user_type || session.role || null;
  const userType = normalizeUserType(
    explicit
    || (session.rep_code ? 'sales_rep' : null)
    || (session.admin_id ? 'admin' : null)
    || (session.customer_id ? 'customer' : null),
    null,
  );

  return {
    ...session,
    sales_rep_id: session.sales_rep_id || session.rep_id || session.created_by_rep_id || null,
    rep_id: session.rep_id ?? null,
    created_by_rep_id: session.created_by_rep_id ?? null,
    capabilities: normalizeCapabilityList(session.capabilities),
    domains: normalizeCapabilityList(session.domains),
    userType,
    user_type: userType,
  };
}

export function isSalesRepSession(session) {
  const normalized = normalizeSessionRecord(session);
  const type = normalizeUserType(normalized?.userType || normalized?.user_type || normalized?.role || null, null);
  return type === 'sales_rep';
}

export function getOwnershipActorId(session) {
  const normalized = normalizeSessionRecord(session);
  if (!isSalesRepSession(normalized)) return null;
  return normalizeIdentifier(normalized?.sales_rep_id || normalized?.id || '');
}

const PROFILE_SELECT = {
  admins: 'id,name,phone,username,is_active,is_blocked,blocked_reason',
  sales_reps: 'id,name,phone,username,region,default_tier_name,is_active,is_blocked,blocked_reason',
  customers: 'id,name,phone,address,username,location,default_tier_name,is_active,is_blocked,blocked_reason,sales_rep_id,created_by_rep_id,customer_type',
};

async function fetchUserProfile(api, table, identifier) {
  const trimmed = normalizeIdentifier(identifier);
  const select = PROFILE_SELECT[table] || PROFILE_SELECT.customers;
  const rows = await api.get(table, {
    select,
    or: `(phone.eq.${trimmed},username.eq.${trimmed})`,
    limit: '1',
  }).catch(async () => {
    const phone = await api.get(table, { select, phone: `eq.${trimmed}`, limit: '1' }).catch(() => []);
    if (phone?.length) return phone;
    return await api.get(table, { select, username: `eq.${trimmed}`, limit: '1' }).catch(() => []);
  });
  return rows?.[0] || null;
}

async function fetchIdentityProfiles(api, identifier) {
  const tables = ['admins', 'sales_reps', 'customers'];
  const results = await Promise.allSettled(tables.map((table) => fetchUserProfile(api, table, identifier)));
  return tables.map((table, index) => ({
    table,
    row: results[index].status === 'fulfilled' ? results[index].value : null,
  })).filter((entry) => entry.row);
}

const USER_TYPE_TO_TABLE = {
  admin: 'admins',
  sales_rep: 'sales_reps',
  customer: 'customers',
};

export function hasCapability() {
  return false;
}

export function canAccessCustomerManagement(session) {
  return isSalesRepSession(session) || normalizeUserType(session?.userType || session?.user_type || session?.role || null, null) === 'sales_manager';
}

export function canAccessOperationalDashboard() {
  return false;
}

const SESSION_STORAGE_KEYS = [storageKeys.session, 'session'];

export function persistSessionRecord(session) {
  const normalized = normalizeSessionRecord(session);
  if (!normalized) return null;
  for (const key of SESSION_STORAGE_KEYS) {
    saveJSON(key, normalized);
  }
  return normalized;
}

export function clearPersistedSession() {
  for (const key of SESSION_STORAGE_KEYS) {
    removeValue(key);
  }
}

export function readPersistedSession() {
  for (const key of SESSION_STORAGE_KEYS) {
    const value = loadJSON(key, null);
    if (value) {
      const normalized = normalizeSessionRecord(value);
      persistSessionRecord(normalized);
      return normalized;
    }
  }
  return null;
}

async function authenticateWithServer(api, identifier, password) {
  const endpoints = [
    'rpc/authenticate_user',
    'rpc/login_user',
    'rpc/auth_login',
  ];
  for (const endpoint of endpoints) {
    try {
      const rows = await api.post(endpoint, { identifier, user_password: password });
      if (Array.isArray(rows) && rows.length) return rows[0];
      if (rows && typeof rows === 'object') return rows;
    } catch {
      // try next endpoint
    }
  }
  throw new Error('AUTH_BACKEND_REQUIRED');
}

export async function refreshSessionProjection(api, session = null, { persist = true } = {}) {
  const baseSession = normalizeSessionRecord(session || readPersistedSession() || null);
  if (!baseSession) return null;
  const normalized = normalizeSessionRecord(baseSession);
  if (persist && normalized) {
    persistSessionRecord(normalized);
  }
  return normalized;
}

export async function login(api, identifier, password) {
  const trimmedIdentifier = normalizeIdentifier(identifier);
  const trimmedPassword = String(password || '').trim();
  if (!trimmedIdentifier || !trimmedPassword) throw new Error('INVALID_CREDENTIALS');

  const authenticated = normalizeSessionRecord(await authenticateWithServer(api, trimmedIdentifier, trimmedPassword));
  const profiles = await fetchIdentityProfiles(api, trimmedIdentifier);
  const profileMap = Object.fromEntries(profiles.map((entry) => [entry.table, entry.row]));
  const authoritativeType = normalizeUserType(authenticated?.userType || authenticated?.user_type || authenticated?.role || null, null);
  if (!authoritativeType) {
    throw new Error('AUTH_ROLE_UNRESOLVED');
  }

  const authoritativeTable = USER_TYPE_TO_TABLE[authoritativeType];
  const authoritativeProfile = authoritativeTable ? profileMap[authoritativeTable] || null : null;
  if (!authoritativeProfile) {
    throw new Error('AUTH_PROFILE_MISSING');
  }

  const session = normalizeSessionRecord({
    ...authenticated,
    ...authoritativeProfile,
    userType: authoritativeType,
    user_type: authoritativeType,
  });

  persistSessionRecord(session);
  publishDomainEvent('auth.login.success', {
    user_id: session.id,
    user_type: session.userType,
    username: session.username || session.phone || '',
  });

  return session;
}

export function logout() {
  clearPersistedSession();
  removeValue(storageKeys.selectedCustomer);
  publishDomainEvent('auth.logout', {});
}

export function currentSession() {
  return readPersistedSession();
}

export async function registerCustomer(api, payload) {
  const exists = await api.get('customers', { phone: `eq.${payload.phone}`, select: 'id', limit: '1' }).catch(() => []);
  if (Array.isArray(exists) && exists.length) throw new Error('DUPLICATE_PHONE');
  const rows = await api.post('customers', {
    name: payload.name,
    phone: payload.phone,
    password: payload.password,
    address: payload.address,
    location: payload.location || null,
    username: payload.username || null,
    customer_type: 'direct',
    sales_rep_id: null,
    created_by: null,
    created_by_rep_id: null,
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  const session = normalizeSessionRecord({ ...created, userType: 'customer', user_type: 'customer' });
  persistSessionRecord(session);
  publishDomainEvent('customer.register', {
    customer_id: session.id,
    username: session.username || session.phone || '',
  });
  return session;
}
