import { hasCapability, normalizeCapabilityList } from './authService.js';
import { publishDomainEvent } from './domainEventService.js';
import { resolveWorkflowActions, getWorkflowStateLabel } from './workflowService.js';

const OPERATIONAL_MODULES = [
  {
    key: 'sales',
    label: 'المبيعات',
    route: 'ops/sales',
    requiredCapabilities: ['orders.view', 'orders.create', 'customers.create', 'customers.manage'],
    description: 'إدارة الطلبات والعملاء المرتبطين بالحساب',
  },
  {
    key: 'sales-manager',
    label: 'مدير البيع',
    route: 'ops/sales-manager',
    requiredCapabilities: ['sales_manager.access', 'dashboard.sales_manager', 'sales_manager.manage_reps'],
    description: 'متابعة المندوبين وربط العملاء وتحليل الأداء',
  },
  {
    key: 'warehouse',
    label: 'المخزن',
    route: 'ops/warehouse',
    requiredCapabilities: ['warehouse.prepare', 'dashboard.warehouse'],
    description: 'تحضير الطلبات ومراقبة جاهزية التشغيل',
  },
  {
    key: 'delivery',
    label: 'الشحن',
    route: 'ops/delivery',
    requiredCapabilities: ['delivery.execute', 'shipment.dispatch', 'dashboard.delivery'],
    description: 'إدارة الشحن والتسليم',
  },
  {
    key: 'treasury',
    label: 'الخزنة',
    route: 'ops/treasury',
    requiredCapabilities: ['treasury.collect', 'dashboard.treasury'],
    description: 'متابعة التحصيلات والتسويات المالية',
  },
  {
    key: 'hr',
    label: 'شؤون العاملين',
    route: 'ops/hr',
    requiredCapabilities: ['attendance.override', 'dashboard.hr'],
    description: 'الحضور والانصراف وصلاحيات العاملين',
  },
  {
    key: 'reports',
    label: 'التقارير',
    route: 'ops/reports',
    requiredCapabilities: ['reports.view', 'dashboard.admin'],
    description: 'لوحات التقارير التشغلية حسب الصلاحيات',
  },
  {
    key: 'admin',
    label: 'الإدارة',
    route: 'ops/admin',
    requiredCapabilities: ['dashboard.admin', 'system.manage_users', 'system.manage_capabilities'],
    description: 'تحكم إداري شامل في النظام',
  },
];

function normalizeId(value) {
  return String(value || '').trim();
}

function createEmptyScope(ownerId = null, module = 'sales-manager') {
  return {
    loaded: false,
    loading: false,
    error: null,
    loadedAt: null,
    ownerId,
    module,
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
  };
}

function resolveOwnerId(session = {}) {
  return normalizeId(
    session?.system_user?.id
      || session?.sales_rep_id
      || session?.rep_id
      || session?.id
      || ''
  );
}

function isModuleVisible(session = {}, module) {
  const caps = normalizeCapabilityList(session?.capabilities || session?.system_user?.capabilities || []);
  const required = Array.isArray(module?.requiredCapabilities) ? module.requiredCapabilities : [];
  if (!required.length) return false;
  return required.some((capability) => caps.includes(capability));
}

export function getOperationalModules(session = {}) {
  return OPERATIONAL_MODULES
    .filter((module) => isModuleVisible(session, module))
    .map((module) => ({ ...module }));
}

export function getOperationalModuleByKey(moduleKey) {
  const key = normalizeId(moduleKey);
  return OPERATIONAL_MODULES.find((module) => module.key === key) || null;
}

export function getDefaultOperationalModule(session = {}) {
  const modules = getOperationalModules(session);
  if (!modules.length) return 'sales';
  if (modules.some((module) => module.key === 'sales-manager')) return 'sales-manager';
  return modules[0].key;
}

export function hasOperationalAccess(session = {}) {
  return getOperationalModules(session).length > 0;
}

export function getOperationalRouteForModule(moduleKey = 'sales-manager') {
  const module = getOperationalModuleByKey(moduleKey);
  return module?.route || `ops/${normalizeId(moduleKey) || 'sales-manager'}`;
}

async function loadManagerCustomers(api, ownerId) {
  const rows = await api.get('customers', {
    select: 'id,name,phone,address,location,location_lat,location_lng,username,created_at,sales_rep_id,created_by,created_by_rep_id,customer_type,owner_user_id,owner_user_type,owner_scope,is_active,is_blocked,blocked_reason',
    or: `(owner_user_id.eq.${ownerId},sales_rep_id.eq.${ownerId},created_by_rep_id.eq.${ownerId},created_by.eq.${ownerId})`,
    order: 'created_at.desc',
  }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function loadManagerReps(api, ownerId) {
  const rows = await api.get('system_users', {
    select: 'id,full_name,phone,username,user_type,manager_user_id,is_active,is_blocked,blocked_reason,created_at,updated_at',
    or: `(manager_user_id.eq.${ownerId},id.eq.${ownerId})`,
    order: 'created_at.desc',
  }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function loadManagerOrders(api, ownerId, customerIds = []) {
  const filters = [
    `sales_rep_id.eq.${ownerId}`,
    `rep_id.eq.${ownerId}`,
    `user_id.eq.${ownerId}`,
  ];
  if (Array.isArray(customerIds) && customerIds.length) {
    filters.push(`customer_id.in.(${customerIds.join(',')})`);
  }
  const rows = await api.get('orders', {
    select: 'id,order_number,invoice_number,created_at,total_amount,status,workflow_status,workflow_state_key,customer_id,user_id,sales_rep_id,rep_id,user_type,customer_type,payment_method,payment_status',
    or: `(${filters.join(',')})`,
    order: 'created_at.desc',
  }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function buildSummary(orders = [], customers = [], reps = []) {
  const summary = {
    customers: Array.isArray(customers) ? customers.length : 0,
    reps: Array.isArray(reps) ? reps.length : 0,
    orders: Array.isArray(orders) ? orders.length : 0,
    pending: 0,
    reviewing: 0,
    preparing: 0,
    dispatched: 0,
    delivered: 0,
    collected: 0,
    returned: 0,
    cancelled: 0,
  };

  for (const order of Array.isArray(orders) ? orders : []) {
    const key = String(order.workflow_state_key || order.workflow_status || order.status || '').trim();
    if (Object.prototype.hasOwnProperty.call(summary, key)) {
      summary[key] += 1;
    }
  }

  return summary;
}

let cachedScopeKey = null;
let cachedScope = createEmptyScope();

export async function loadManagerScope(api, session = {}, { force = false } = {}) {
  const ownerId = resolveOwnerId(session);
  const module = getDefaultOperationalModule(session);
  const scopeKey = `${ownerId}:${module}`;

  if (cachedScope.loaded && cachedScopeKey === scopeKey && !force) {
    return {
      ...cachedScope,
      modules: cachedScope.modules.map((entry) => ({ ...entry })),
      teamCustomers: cachedScope.teamCustomers.map((entry) => ({ ...entry })),
      teamReps: cachedScope.teamReps.map((entry) => ({ ...entry })),
      teamOrders: cachedScope.teamOrders.map((entry) => ({ ...entry })),
      summary: { ...cachedScope.summary },
    };
  }

  if (!ownerId || !hasOperationalAccess(session)) {
    cachedScopeKey = scopeKey;
    cachedScope = createEmptyScope(ownerId, module);
    return {
      ...cachedScope,
      modules: getOperationalModules(session),
    };
  }

  const nextScope = createEmptyScope(ownerId, module);
  nextScope.loading = true;
  nextScope.modules = getOperationalModules(session);

  try {
    const teamCustomers = await loadManagerCustomers(api, ownerId);
    const customerIds = Array.from(new Set(teamCustomers.map((customer) => normalizeId(customer.id)).filter(Boolean)));
    const [teamReps, teamOrders] = await Promise.all([
      loadManagerReps(api, ownerId),
      loadManagerOrders(api, ownerId, customerIds),
    ]);

    nextScope.loaded = true;
    nextScope.loading = false;
    nextScope.error = null;
    nextScope.loadedAt = new Date().toISOString();
    nextScope.teamCustomers = teamCustomers;
    nextScope.teamReps = teamReps;
    nextScope.teamOrders = teamOrders;
    nextScope.summary = buildSummary(teamOrders, teamCustomers, teamReps);

    cachedScopeKey = scopeKey;
    cachedScope = nextScope;

    publishDomainEvent('manager.scope.loaded', {
      owner_id: ownerId,
      module,
      customers: nextScope.summary.customers,
      reps: nextScope.summary.reps,
      orders: nextScope.summary.orders,
    });

    return {
      ...nextScope,
      modules: nextScope.modules.map((entry) => ({ ...entry })),
      teamCustomers: nextScope.teamCustomers.map((entry) => ({ ...entry })),
      teamReps: nextScope.teamReps.map((entry) => ({ ...entry })),
      teamOrders: nextScope.teamOrders.map((entry) => ({ ...entry })),
      summary: { ...nextScope.summary },
    };
  } catch (error) {
    nextScope.loaded = true;
    nextScope.loading = false;
    nextScope.error = error?.message || 'MANAGER_SCOPE_LOAD_FAILED';
    nextScope.loadedAt = new Date().toISOString();
    cachedScopeKey = scopeKey;
    cachedScope = nextScope;
    return {
      ...nextScope,
      modules: nextScope.modules.map((entry) => ({ ...entry })),
      teamCustomers: [],
      teamReps: [],
      teamOrders: [],
      summary: { ...nextScope.summary },
    };
  }
}

export async function loadManagerScopeIntoState(store, api, session = null, { force = false } = {}) {
  const current = store.getState();
  const scope = await loadManagerScope(api, session || current.auth.session || {}, { force });
  store.update((draft) => {
    draft.runtime.manager = {
      ...draft.runtime.manager,
      ...scope,
      modules: Array.isArray(scope.modules) ? scope.modules.map((entry) => ({ ...entry })) : [],
      teamCustomers: Array.isArray(scope.teamCustomers) ? scope.teamCustomers.map((entry) => ({ ...entry })) : [],
      teamReps: Array.isArray(scope.teamReps) ? scope.teamReps.map((entry) => ({ ...entry })) : [],
      teamOrders: Array.isArray(scope.teamOrders) ? scope.teamOrders.map((entry) => ({ ...entry })) : [],
      summary: { ...(scope.summary || {}) },
      ownerId: scope.ownerId || null,
      module: scope.module || 'sales-manager',
    };
    draft.runtime.loading.manager = Boolean(scope.loading);
    draft.runtime.lifecycle.managerReady = Boolean(scope.loaded && !scope.loading && !scope.error);
  }, { dirty: ['opsNav', 'page', 'header', 'drawer', 'modals'] });
  return scope;
}

export function getManagerScopeSnapshot() {
  return {
    ...cachedScope,
    modules: cachedScope.modules.map((entry) => ({ ...entry })),
    teamCustomers: cachedScope.teamCustomers.map((entry) => ({ ...entry })),
    teamReps: cachedScope.teamReps.map((entry) => ({ ...entry })),
    teamOrders: cachedScope.teamOrders.map((entry) => ({ ...entry })),
    summary: { ...cachedScope.summary },
  };
}

export function getManagerWorkflowOverview(session, orders = []) {
  const items = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    items.push({
      ...order,
      workflowActions: resolveWorkflowActions(order, session),
      workflowLabel: getWorkflowStateLabel(order.workflow_state_key || order.workflow_status || order.status),
    });
  }
  return items;
}

export function createManagerRuntimeFacade() {
  return {
    getOperationalModules,
    getOperationalModuleByKey,
    getDefaultOperationalModule,
    getOperationalRouteForModule,
    hasOperationalAccess,
    loadManagerScope,
    loadManagerScopeIntoState,
    getManagerScopeSnapshot,
    getManagerWorkflowOverview,
  };
}
