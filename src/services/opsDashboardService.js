import { canAccessCustomerManagement, canAccessOperationalDashboard, hasCapability, isSalesRepSession, normalizeCapabilityList } from './authService.js';
import { formatMoney } from './invoiceService.js';
import { getDefaultOperationalModule, getOperationalModules, getOperationalModuleByKey, getOperationalQuickActions, getOperationalRouteForModule, getOperationalModuleLabel, hasOperationalAccess, isOperationalModuleReady } from './managerService.js';
import { getWorkflowStateLabel, normalizeWorkflowStateKey, resolveWorkflowActions } from './workflowService.js';

const PRIORITY_BUCKETS = [
  { key: 'review', title: 'مراجعة', states: ['pending', 'reviewing'] },
  { key: 'prepare', title: 'تحضير', states: ['preparing'] },
  { key: 'dispatch', title: 'شحن', states: ['dispatched'] },
  { key: 'complete', title: 'إغلاق', states: ['delivered', 'collected'] },
  { key: 'returns', title: 'مرتجعات', states: ['returned'] },
  { key: 'cancelled', title: 'ملغاة', states: ['cancelled'] },
];

function normalizeId(value) {
  return String(value || '').trim();
}

function sameDay(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const l = new Date(left);
  const r = new Date(right);
  return l.getFullYear() === r.getFullYear()
    && l.getMonth() === r.getMonth()
    && l.getDate() === r.getDate();
}

function ageHours(timestamp) {
  const value = new Date(timestamp || 0).getTime();
  if (!Number.isFinite(value) || value <= 0) return null;
  return (Date.now() - value) / 36e5;
}

function getOrders(state) {
  const managerScope = state?.runtime?.manager || {};
  const priorityOrders = Array.isArray(managerScope.priorityOrders) && managerScope.priorityOrders.length
    ? managerScope.priorityOrders
    : [];
  if (priorityOrders.length) return priorityOrders;
  return Array.isArray(managerScope.teamOrders) ? managerScope.teamOrders : [];
}

function getCustomers(state) {
  const managerScope = state?.runtime?.manager || {};
  return Array.isArray(managerScope.teamCustomers) ? managerScope.teamCustomers : [];
}

function getSessionCapabilities(session) {
  return normalizeCapabilityList(session?.capabilities || session?.system_user?.capabilities || []);
}

function getOrderState(order) {
  return normalizeWorkflowStateKey(order?.workflow_state_key || order?.workflow_status || order?.status) || 'pending';
}

function getOrderDate(order) {
  return order?.updated_at || order?.created_at || order?.order_date || order?.date || null;
}

function hasDispatchCapability(session) {
  return hasCapability(session, ['delivery.execute', 'shipment.dispatch', 'warehouse.prepare', 'orders.manage', 'orders.update']);
}

function hasReviewCapability(session) {
  return hasCapability(session, ['orders.review', 'orders.manage', 'orders.update', 'sales_manager.manage_reps', 'dashboard.sales_manager']);
}

function hasFollowUpCapability(session) {
  return hasCapability(session, ['customers.manage', 'customers.create', 'sales_manager.access', 'dashboard.sales_manager', 'orders.view']);
}

function buildCounters(state) {
  const orders = getOrders(state);
  const customers = getCustomers(state);
  const summary = state?.runtime?.manager?.summary || {};
  const pendingReview = orders.filter((order) => ['pending', 'reviewing'].includes(getOrderState(order))).length;
  const preparing = orders.filter((order) => getOrderState(order) === 'preparing').length;
  const dispatchedToday = orders.filter((order) => getOrderState(order) === 'dispatched' && sameDay(new Date(getOrderDate(order) || 0).getTime(), Date.now())).length;
  const delayed = orders.filter((order) => {
    const stateKey = getOrderState(order);
    if (!['pending', 'reviewing', 'preparing'].includes(stateKey)) return false;
    const hours = ageHours(getOrderDate(order));
    return hours !== null && hours >= 48;
  }).length;
  const returnsPending = orders.filter((order) => getOrderState(order) === 'returned').length;
  const followUpCustomers = customers.filter((customer) => {
    const latest = getLatestCustomerOrder(customer, orders);
    if (!latest) return true;
    const hours = ageHours(getOrderDate(latest));
    return hours !== null && hours >= (24 * 30);
  }).length;

  return [
    { key: 'new-orders', label: 'طلبات جديدة', value: Number(summary.pending || 0), hint: 'من workflow_state_key' },
    { key: 'pending-review', label: 'تحتاج مراجعة', value: pendingReview, hint: 'محتجزة للتنفيذ' },
    { key: 'preparing', label: 'جاري التحضير', value: preparing, hint: 'في المسار التشغيلي' },
    { key: 'dispatched-today', label: 'خرج للشحن اليوم', value: dispatchedToday, hint: 'حركة يومية' },
    { key: 'delayed', label: 'متأخرة', value: delayed, hint: 'أكثر من 48 ساعة' },
    { key: 'returns', label: 'مرتجعات', value: returnsPending, hint: 'بحاجة إجراء' },
    { key: 'follow-up', label: 'عملاء متابعة', value: followUpCustomers, hint: 'لا يوجد نشاط حديث' },
    { key: 'total-orders', label: 'إجمالي الطلبات', value: Number(summary.orders || orders.length || 0), hint: 'السجل التشغيلي' },
  ];
}

function getLatestCustomerOrder(customer, orders) {
  const customerId = normalizeId(customer?.id);
  if (!customerId || !Array.isArray(orders)) return null;
  return orders
    .filter((order) => normalizeId(order?.customer_id) === customerId)
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime())[0] || null;
}

function buildQueueItems(state, bucket) {
  const session = state?.auth?.session || {};
  const orders = getOrders(state)
    .map((order) => {
      const stateKey = getOrderState(order);
      const workflow = resolveWorkflowActions(order, session);
      return {
        ...order,
        workflowStateKey: stateKey,
        workflowStateLabel: workflow.currentStateLabel || getWorkflowStateLabel(stateKey),
        workflowActions: workflow,
      };
    })
    .filter((order) => bucket.states.includes(order.workflowStateKey));

  const sorted = orders.sort((left, right) => {
    const leftPriority = bucket.key === 'returns' ? 1 : bucket.states.indexOf(left.workflowStateKey);
    const rightPriority = bucket.key === 'returns' ? 1 : bucket.states.indexOf(right.workflowStateKey);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftDate = new Date(getOrderDate(left) || 0).getTime();
    const rightDate = new Date(getOrderDate(right) || 0).getTime();
    return rightDate - leftDate;
  });

  return sorted.slice(0, 4);
}

function buildQueues(state) {
  return PRIORITY_BUCKETS.map((bucket) => {
    const items = buildQueueItems(state, bucket);
    const count = (getOrders(state) || []).filter((order) => bucket.states.includes(getOrderState(order))).length;
    return {
      ...bucket,
      count,
      items,
      emptyLabel: 'لا توجد عناصر',
    };
  });
}

function buildQuickActions(session, moduleKey = 'sales-manager') {
  const shared = getOperationalQuickActions(session);
  const capabilities = getSessionCapabilities(session);
  const primaryActionsByRole = [];

  if (isSalesRepSession(session)) {
    primaryActionsByRole.push(
      { action: 'go-checkout', label: 'إنشاء طلب', icon: '🛒', description: 'فتح مسار الطلب مباشرة', enabled: true },
      { action: 'go-customers', label: 'عملائي', icon: '👥', description: 'العملاء المرتبطون بي', enabled: true },
      { action: 'go-invoices', label: 'فواتير اليوم', icon: '📦', description: 'الفواتير والطلبات السابقة', enabled: true },
      { action: 'go-ops', label: 'طلبات تحتاج متابعة', icon: '⚠️', description: 'الطلبات المتأخرة أو المعلقة', enabled: hasOperationalAccess(session) || canAccessOperationalDashboard(session),
    );
  } else {
    primaryActionsByRole.push(
      { action: 'go-ops', label: 'لوحة التحكم', icon: '🧭', description: 'العودة إلى مركز التشغيل', enabled: hasOperationalAccess(session) || canAccessOperationalDashboard(session) },
      { action: 'go-invoices', label: 'فواتير اليوم', icon: '📦', description: 'مراجعة المحفظة الجارية', enabled: true },
    );
  }

  if (moduleKey === 'warehouse' || capabilities.includes('warehouse.prepare')) {
    primaryActionsByRole.push(
      { action: 'go-ops-module', module: 'warehouse', label: 'تجهيز الطلبات', icon: '📦', description: 'مراجعة أوامر التحضير', enabled: isOperationalModuleReady('warehouse') },
      { action: 'go-ops-module', module: 'warehouse', label: 'النواقص', icon: '📉', description: 'العناصر غير الجاهزة', enabled: isOperationalModuleReady('warehouse') },
    );
  }

  if (moduleKey === 'delivery' || capabilities.includes('delivery.execute') || capabilities.includes('shipment.dispatch')) {
    primaryActionsByRole.push(
      { action: 'go-ops-module', module: 'delivery', label: 'شحنات اليوم', icon: '🚚', description: 'خطة التسليم الحالية', enabled: isOperationalModuleReady('delivery') },
      { action: 'go-ops-module', module: 'delivery', label: 'المرتجعات', icon: '↩️', description: 'الشحنات الراجعة', enabled: isOperationalModuleReady('delivery') },
    );
  }

  if (moduleKey === 'sales-manager' || hasReviewCapability(session) || canAccessOperationalDashboard(session)) {
    primaryActionsByRole.push(
      { action: 'go-ops', label: 'مراجعات معلقة', icon: '📝', description: 'الطلبات التي تحتاج قرارًا', enabled: true },
      { action: 'go-ops', label: 'متابعة الفريق', icon: '👥', description: 'متابعة المندوبين والعملاء', enabled: true },
    );
  }

  const merged = [...primaryActionsByRole, ...shared];
  const seen = new Set();
  return merged.filter((item) => {
    const key = `${item.action}:${item.module || ''}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildModuleRail(session) {
  return getOperationalModules(session).map((module) => ({
    ...module,
    disabled: !module.isReady,
    ctaLabel: module.isReady ? 'فتح' : 'قريبًا',
  }));
}

function buildExecutionCards(state) {
  const session = state?.auth?.session || {};
  const orders = getOrders(state);
  const customerMap = Object.fromEntries(getCustomers(state).map((customer) => [normalizeId(customer.id), customer]));
  return orders.slice(0, 8).map((order) => {
    const workflow = resolveWorkflowActions(order, session);
    const firstTransition = Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions[0] : null;
    const customer = customerMap[normalizeId(order.customer_id)];
    const customerName = customer?.name || order.customer_name || order.name || `عميل #${normalizeId(order.customer_id).slice(0, 6) || '—'}`;
    const total = formatMoney(Number(order.total_amount || 0));
    return {
      id: normalizeId(order.id),
      orderNumber: order.order_number || order.invoice_number || order.id,
      customerName,
      total,
      stateLabel: workflow.currentStateLabel || getWorkflowStateLabel(workflow.currentStateKey),
      actionLabel: firstTransition?.to_state_label || 'تنفيذ',
      canExecute: Boolean(firstTransition),
      nextStateKey: firstTransition?.to_state_key || null,
      executableCount: Array.isArray(workflow.executableTransitions) ? workflow.executableTransitions.length : 0,
      workflowStateKey: workflow.currentStateKey,
    };
  });
}

export function canOpenOpsWorkspace(session = {}) {
  return hasOperationalAccess(session) || canAccessOperationalDashboard(session) || hasCapability(session, ['dashboard.sales_manager', 'dashboard.admin', 'sales_manager.access']);
}

export function getOpsWorkspaceModule(session = {}, requestedModule = null) {
  const defaultModule = getDefaultOperationalModule(session);
  const moduleKey = normalizeId(requestedModule) || defaultModule;
  const module = getOperationalModuleByKey(moduleKey);
  if (!module) return getOperationalModuleByKey(defaultModule) || null;
  if (module.isReady || module.runtimeReady) return module;
  if (isOperationalModuleReady(defaultModule)) return getOperationalModuleByKey(defaultModule) || module;
  return module;
}

export function createOpsDashboardModel(state) {
  const session = state?.auth?.session || null;
  const routeModule = normalizeId(state?.app?.route?.params?.module || '');
  const module = getOpsWorkspaceModule(session, routeModule);
  const moduleKey = module?.key || getDefaultOperationalModule(session);
  const counters = buildCounters(state);
  const queues = buildQueues(state);
  const quickActions = buildQuickActions(session, moduleKey);
  const moduleRail = buildModuleRail(session);
  const executionCards = buildExecutionCards(state);

  return {
    session,
    canOpen: canOpenOpsWorkspace(session),
    moduleKey,
    module,
    moduleLabel: getOperationalModuleLabel(moduleKey),
    moduleRoute: getOperationalRouteForModule(moduleKey),
    counters,
    queues,
    quickActions,
    moduleRail,
    executionCards,
    priorityOrders: executionCards,
    workflowSummary: state?.runtime?.manager?.summary || {},
    teamCustomers: getCustomers(state),
    teamOrders: getOrders(state),
    teamReps: Array.isArray(state?.runtime?.manager?.teamReps) ? state.runtime.manager.teamReps : [],
  };
}
