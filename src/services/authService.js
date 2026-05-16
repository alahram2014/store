import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { publishDomainEvent } from './domainEventService.js';

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim();
}

function normalizeCapabilityToken(value) {
  const raw = normalizeIdentifier(value).toLowerCase();
  if (!raw) return '';
  if (!raw.includes('.') && raw.includes('_')) {
    return raw.replace(/_+/g, '.');
  }
  return raw;
}

function extractCapabilityTokens(value, output) {
  if (!output) return;
  if (Array.isArray(value)) {
    for (const entry of value) extractCapabilityTokens(entry, output);
    return;
  }
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalizeCapabilityToken(value);
    if (normalized) output.push(normalized);
    return;
  }
  if (typeof value === 'object') {
    const candidateFields = [
      value.capability_key,
      value.permission_key,
      value.capability,
      value.key,
      value.value,
      value.name,
    ];
    for (const candidate of candidateFields) {
      extractCapabilityTokens(candidate, output);
    }
    if (Array.isArray(value.capabilities)) extractCapabilityTokens(value.capabilities, output);
    if (Array.isArray(value.permissions)) extractCapabilityTokens(value.permissions, output);
  }
}

export function normalizeUserType(value, fallback = null) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'rep' || raw === 'sales_rep' || raw === 'sales rep' || raw === 'sales-rep') return 'sales_rep';
  if (raw === 'sales_manager' || raw === 'sales manager') return 'sales_manager';
  if (raw === 'admin') return 'admin';
  if (raw === 'customer' || raw === 'direct') return 'customer';
  return fallback;
}

function mergeNormalizedListSources(...sources) {
  const merged = [];
  for (const source of sources) {
    merged.push(...normalizeCapabilityList(source));
  }
  return Array.from(new Set(merged.filter(Boolean)));
}

function collectSecurityClaims(session = {}) {
  return {
    capabilities: mergeNormalizedListSources(
      session.capabilities,
      session.system_user?.capabilities,
      session.security_projection?.capabilities,
      session.authority?.capabilities,
      session.permissions?.capabilities,
    ),
    domains: mergeNormalizedListSources(
      session.domains,
      session.system_user?.domains,
      session.security_projection?.domains,
      session.authority?.domains,
      session.permissions?.domains,
    ),
  };
}

function collectCapabilityRows(rows = []) {
  const values = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    values.push(
      row?.capability_key,
      row?.capability,
      row?.capability_name,
      row?.permission_key,
      row?.key,
      row?.name,
      row?.capabilities,
    );
  }
  return mergeNormalizedListSources(values);
}

function collectDomainRows(rows = []) {
  const values = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    values.push(
      row?.domain_key,
      row?.domain,
      row?.domain_name,
      row?.scope_key,
      row?.scope,
      row?.domains,
    );
  }
  return mergeNormalizedListSources(values);
}

function mergeSessionSecurityClaims(session, claims = {}) {
  const existing = collectSecurityClaims(session);
  const capabilities = mergeNormalizedListSources(existing.capabilities, claims.capabilities);
  const domains = mergeNormalizedListSources(existing.domains, claims.domains);
  return {
    ...session,
    capabilities,
    domains,
    system_user: {
      ...(session?.system_user || {}),
      capabilities,
      domains,
    },
    security_projection: {
      ...(session?.security_projection || {}),
      capabilities,
      domains,
      projected_at: claims.projected_at || session?.security_projection?.projected_at || null,
    },
  };
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
  const systemUserId = session.system_user?.id || session.system_user_id || null;
  const claims = collectSecurityClaims(session);
  return {
    ...session,
    sales_rep_id: salesRepId || session.sales_rep_id || session.rep_id || session.created_by_rep_id || null,
    rep_id: session.rep_id ?? null,
    created_by_rep_id: session.created_by_rep_id ?? null,
    system_user_id: systemUserId || null,
    system_user: session.system_user ? {
      ...session.system_user,
    } : undefined,
    capabilities: claims.capabilities,
    domains: claims.domains,
    userType,
    user_type: userType,
    security_projection: session.security_projection ? {
      ...session.security_projection,
      capabilities: claims.capabilities,
      domains: claims.domains,
    } : undefined,
  };
}

export function isSalesRepSession(session) {
  const normalized = normalizeSessionRecord(session);
  const type = normalizeUserType(normalized?.userType || normalized?.user_type || normalized?.role || null, null);
  return type === 'sales_rep';
}

export function getOwnershipActorId(session) {
  const normalized = normalizeSessionRecord(session);
  const actorId = normalizeIdentifier(
    normalized?.system_user?.id
      || normalized?.system_user_id
      || normalized?.sales_rep_id
      || normalized?.rep_id
      || normalized?.id
      || '',
  );
  if (!actorId) return null;
  if (hasOperationalAccess(normalized) || isSalesRepSession(normalized) || Boolean(normalized?.system_user)) {
    return actorId;
  }
  return null;
}

const PROFILE_SELECT = {
  admins: 'id,name,phone,username,is_active,is_blocked,blocked_reason',
  system_users: 'id,auth_user_id,full_name,phone,username,user_type,manager_user_id,is_active,is_blocked,blocked_reason,created_at,updated_at',
  sales_reps: 'id,name,phone,username,region,default_tier_name,is_active,is_blocked,blocked_reason',
  customers: '*',
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
  const tables = ['admins', 'system_users', 'sales_reps', 'customers'];
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

export function normalizeCapabilityList(value) {
  const tokens = [];
  extractCapabilityTokens(value, tokens);
  return Array.from(new Set(tokens.filter(Boolean)));
}

export function hasCapability(session, required, { all = false } = {}) {
  const owned = new Set(normalizeCapabilityList([
    session?.capabilities,
    session?.system_user?.capabilities,
    session?.security_projection?.capabilities,
    session?.authority?.capabilities,
    session?.permissions?.capabilities,
  ]));
  const list = normalizeCapabilityList(Array.isArray(required) ? required : [required]);
  if (!list.length) return false;
  return all ? list.every((capabilityKey) => owned.has(capabilityKey)) : list.some((capabilityKey) => owned.has(capabilityKey));
}

const OPERATIONAL_CAPABILITY_PREFIXES = [
  'dashboard.',
  'system.',
  'warehouse.',
  'shipment.',
  'delivery.',
  'sales_manager.',
  'orders.',
  'workflow.',
  'reports.',
  'products.',
  'catalog.',
  'companies.',
  'customers.',
];

const OPERATIONAL_CAPABILITIES = new Set([
  'dashboard.admin',
  'dashboard.sales_manager',
  'dashboard.warehouse',
  'dashboard.delivery',
  'dashboard.treasury',
  'dashboard.hr',
  'system.manage_users',
  'system.manage_capabilities',
  'system.manage_dashboard',
  'orders.view',
  'orders.create',
  'orders.review',
  'orders.update',
  'orders.manage',
  'orders.change_status',
  'customers.view',
  'customers.create',
  'customers.manage',
  'sales_manager.access',
  'sales_manager.manage_reps',
  'sales_manager.assign_customers',
  'warehouse.prepare',
  'shipment.dispatch',
  'delivery.execute',
  'workflow.view',
  'workflow.manage',
  'workflow.transition',
  'reports.view',
  'products.manage',
  'catalog.manage',
  'pricing.tiers.manage',
  'stock.manage',
  'companies.manage',
  'company.manage',
]);

export function hasOperationalAccess(session = {}) {
  const capabilities = normalizeCapabilityList([
    session?.capabilities,
    session?.system_user?.capabilities,
    session?.security_projection?.capabilities,
    session?.authority?.capabilities,
    session?.permissions?.capabilities,
  ]);
  if (!capabilities.length) return false;
  return capabilities.some((capability) => {
    if (OPERATIONAL_CAPABILITIES.has(capability)) return true;
    return OPERATIONAL_CAPABILITY_PREFIXES.some((prefix) => capability.startsWith(prefix));
  });
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

export function canAccessCustomerManagement(session) {
  return hasOperationalAccess(session) || hasCapability(session, [
    'sales_manager.access',
    'sales_manager.assign_customers',
    'sales_manager.manage_reps',
    'customers.manage',
    'customers.create',
    'customers.view',
    'dashboard.admin',
    'system.manage_dashboard',
  ]);
}

export function canAccessOperationalDashboard(session) {
  return hasCapability(session, [
    'dashboard.admin',
    'dashboard.sales_manager',
    'system.manage_dashboard',
    'sales_manager.access',
    'reports.view',
    'users.manage',
    'system.manage_users',
    'system.manage_capabilities',
    'products.manage',
    'catalog.manage',
    'companies.manage',
    'workflow.manage',
  ]);
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


async function queryCapabilityProjectionRows(api, normalizedSession, identifier) {
  const resources = [
    'v_system_users_capabilities',
  ];
  const filters = [];

  if (identifier) {
    filters.push({ phone: `eq.${identifier}` });
    filters.push({ username: `eq.${identifier}` });
  }

  const systemUserId = normalizeIdentifier(
    normalizedSession?.system_user?.id
    || normalizedSession?.system_user_id
    || normalizedSession?.auth_user_id
    || '',
  );
  if (systemUserId) {
    filters.push({ system_user_id: `eq.${systemUserId}` });
  }

  for (const resource of resources) {
    for (const filter of filters) {
      const rows = await api.get(resource, {
        select: '*',
        ...filter,
        limit: '200',
      }).catch(() => []);
      if (Array.isArray(rows) && rows.length) {
        return rows;
      }
    }
  }

  return [];
}

async function enrichOperationalSession(api, session) {
  let normalizedSession = normalizeSessionRecord(session);
  const identifier = normalizeIdentifier(normalizedSession?.username || normalizedSession?.phone || normalizedSession?.system_user?.username || normalizedSession?.system_user?.phone || '');

  if (!identifier && !normalizedSession?.system_user?.id && !normalizedSession?.id) {
    return normalizedSession;
  }

  if (!normalizedSession?.system_user?.id) {
    const systemUser = await fetchUserProfile(api, 'system_users', identifier).catch(() => null);
    if (systemUser) {
      normalizedSession = normalizeSessionRecord({
        ...normalizedSession,
        system_user: systemUser,
        system_user_id: systemUser.id,
      });
    }
  }

  let rows = await queryCapabilityProjectionRows(api, normalizedSession, identifier);

  let salesRepProfile = null;
  if (normalizedSession?.sales_rep_id) {
    const repRows = await api.get('sales_reps', {
      select: 'id,name,phone',
      id: `eq.${normalizedSession.sales_rep_id}`,
      limit: '1',
    }).catch(() => []);
    salesRepProfile = repRows?.[0] || null;
  }

  const currentClaims = collectSecurityClaims(normalizedSession);

  if (!Array.isArray(rows) || !rows.length) {
    return normalizeSessionRecord({
      ...normalizedSession,
      sales_rep_name: salesRepProfile?.name || null,
      sales_rep_phone: salesRepProfile?.phone || null,
      capabilities: currentClaims.capabilities,
      domains: currentClaims.domains,
      security_projection: {
        ...(normalizedSession.security_projection || {}),
        capabilities: currentClaims.capabilities,
        domains: currentClaims.domains,
        projected_at: new Date().toISOString(),
        source: 'persisted-session',
      },
    });
  }

  const first = rows[0] || {};
  const projectedClaims = {
    capabilities: mergeNormalizedListSources(
      currentClaims.capabilities,
      collectCapabilityRows(rows),
    ),
    domains: mergeNormalizedListSources(
      currentClaims.domains,
      collectDomainRows(rows),
    ),
  };

  const projectedSession = mergeSessionSecurityClaims({
    ...normalizedSession,
    sales_rep_name: salesRepProfile?.name || null,
    sales_rep_phone: salesRepProfile?.phone || null,
    system_user: {
      ...(normalizedSession.system_user || {}),
      id: first.system_user_id || normalizedSession.system_user?.id || normalizedSession.system_user_id || normalizedSession.id || null,
      full_name: first.full_name || normalizedSession.system_user?.full_name || normalizedSession.full_name || null,
      username: first.username || normalizedSession.system_user?.username || normalizedSession.username || normalizedSession.phone || null,
      user_type: first.user_type || normalizedSession.system_user?.user_type || normalizedSession.user_type || normalizedSession.userType || null,
      is_active: first.is_active ?? normalizedSession.system_user?.is_active ?? normalizedSession.is_active ?? null,
      is_blocked: first.is_blocked ?? normalizedSession.system_user?.is_blocked ?? normalizedSession.is_blocked ?? null,
      capabilities: projectedClaims.capabilities,
      domains: projectedClaims.domains,
    },
  }, {
    capabilities: projectedClaims.capabilities,
    domains: projectedClaims.domains,
    projected_at: new Date().toISOString(),
  });

  return normalizeSessionRecord(projectedSession);
}

export async function refreshSessionProjection(api, session = null, { persist = true } = {}) {
  const baseSession = normalizeSessionRecord(session || readPersistedSession() || null);
  if (!baseSession) return null;
  const projected = await enrichOperationalSession(api, baseSession);
  const normalized = normalizeSessionRecord(projected);
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
  const authoritativeType = resolveAuthoritativeUserType(authenticated);
  if (!authoritativeType) {
    throw new Error('AUTH_ROLE_UNRESOLVED');
  }

  const authoritativeTable = USER_TYPE_TO_TABLE[authoritativeType];
  const authoritativeProfile = authoritativeTable ? profileMap[authoritativeTable] || null : null;
  if (!authoritativeProfile) {
    throw new Error('AUTH_PROFILE_MISSING');
  }

  const systemUserProfile = profileMap.system_users || null;

  const session = normalizeSessionRecord({
    ...authenticated,
    ...authoritativeProfile,
    system_user: systemUserProfile ? { ...systemUserProfile } : undefined,
    system_user_id: systemUserProfile?.id || authenticated?.system_user_id || null,
    userType: authoritativeType,
    user_type: authoritativeType,
  });

  if (normalizeUserType(session?.userType, null) !== authoritativeType) {
    throw new Error('AUTH_ROLE_UNRESOLVED');
  }

  const enrichedSession = await enrichOperationalSession(api, session);

  persistSessionRecord(enrichedSession);
  publishDomainEvent('auth.login.success', {
    user_id: enrichedSession.id,
    user_type: enrichedSession.userType,
    username: enrichedSession.username || enrichedSession.phone || '',
  });

  return enrichedSession;
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
