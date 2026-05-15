import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { publishDomainEvent } from './domainEventService.js';

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim();
}

export function normalizeUserType(value, fallback = null) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'rep' || raw === 'sales_rep' || raw === 'sales rep' || raw === 'sales-rep') return 'sales_rep';
  if (raw === 'admin') return 'admin';
  if (raw === 'customer' || raw === 'direct') return 'customer';
  return fallback;
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
  const salesRepId = session.sales_rep_id || session.rep_id || session.created_by_rep_id || null;
  return {
    ...session,
    sales_rep_id: salesRepId || session.sales_rep_id || session.rep_id || session.created_by_rep_id || null,
    rep_id: session.rep_id ?? null,
    created_by_rep_id: session.created_by_rep_id ?? null,
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

function resolveAuthoritativeUserType(authenticated) {
  const authType = normalizeUserType(authenticated?.userType || authenticated?.user_type || authenticated?.role || null, null);
  return authType || null;
}

const USER_TYPE_TO_TABLE = {
  admin: 'admins',
  sales_rep: 'sales_reps',
  customer: 'customers',
};

function normalizeCapabilityList(value) {
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

async function enrichOperationalSession(api, session) {
  const normalizedSession = normalizeSessionRecord(session);
  const identifier = normalizeIdentifier(normalizedSession?.username || normalizedSession?.phone || '');

  if (!identifier) {
    return normalizedSession;
  }

  let rows = await api.get('v_system_users_capabilities', {
    select: '*',
    phone: `eq.${identifier}`,
  }).catch(() => []);

  if (!rows?.length) {
    rows = await api.get('v_system_users_capabilities', {
      select: '*',
      username: `eq.${identifier}`,
    }).catch(() => []);
  }

  let salesRepProfile = null;
  if (normalizedSession?.sales_rep_id) {
    const repRows = await api.get('sales_reps', {
      select: 'id,name,phone',
      id: `eq.${normalizedSession.sales_rep_id}`,
      limit: '1',
    }).catch(() => []);
    salesRepProfile = repRows?.[0] || null;
  }

  if (!Array.isArray(rows) || !rows.length) {
    return {
      ...normalizedSession,
      sales_rep_name: salesRepProfile?.name || null,
      sales_rep_phone: salesRepProfile?.phone || null,
      capabilities: normalizeCapabilityList(normalizedSession?.capabilities),
      domains: Array.isArray(normalizedSession?.domains) ? normalizedSession.domains.slice() : [],
    };
  }

  const first = rows[0];
  const capabilities = Array.from(new Set(rows.map((row) => row.capability_key).filter(Boolean)));
  const domains = Array.from(new Set(rows.map((row) => row.domain_key).filter(Boolean)));

  return {
    ...normalizedSession,
    sales_rep_name: salesRepProfile?.name || null,
    sales_rep_phone: salesRepProfile?.phone || null,
    system_user: {
      id: first.system_user_id,
      full_name: first.full_name,
      username: first.username,
      user_type: first.user_type,
      is_active: first.is_active,
      is_blocked: first.is_blocked,
    },
    capabilities,
    domains,
  };
}

export async function login(api, identifier, password) {
  const trimmedIdentifier = normalizeIdentifier(identifier);
  const trimmedPassword = String(password || '').trim();
  if (!trimmedIdentifier || !trimmedPassword) throw new Error('INVALID_CREDENTIALS');

  const authenticated = normalizeSessionRecord(await authenticateWithServer(api, trimmedIdentifier, trimmedPassword));
  const profiles = await fetchIdentityProfiles(api, trimmedIdentifier);
  const profileMap = Object.fromEntries(profiles.map((entry) => [entry.table, entry.row]));
  const authoritativeType = resolveAuthoritativeUserType(authenticated);
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

  if (normalizeUserType(session?.userType, null) !== authoritativeType) {
    throw new Error('AUTH_ROLE_UNRESOLVED');
  }

  const enrichedSession = await enrichOperationalSession(api, session);

  saveJSON(storageKeys.session, enrichedSession);
  publishDomainEvent('auth.login.success', {
    user_id: enrichedSession.id,
    user_type: enrichedSession.userType,
    username: enrichedSession.username || enrichedSession.phone || '',
  });

  return enrichedSession;
}

export function logout() {
  removeValue(storageKeys.session);
  removeValue(storageKeys.selectedCustomer);
  publishDomainEvent('auth.logout', {});
}

export function currentSession() {
  return normalizeSessionRecord(loadJSON(storageKeys.session, null));
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
  saveJSON(storageKeys.session, session);
  publishDomainEvent('customer.register', {
    customer_id: session.id,
    username: session.username || session.phone || '',
  });
  return session;
}
