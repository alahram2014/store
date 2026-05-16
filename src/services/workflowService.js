const CANONICAL_LABELS = {
  pending: 'طلب جديد',
  reviewing: 'تحت المراجعة',
  preparing: 'جاري التحضير',
  dispatched: 'خرج للشحن',
  delivered: 'تم التسليم',
  collected: 'تم التحصيل',
  returned: 'مرتجع',
  cancelled: 'ملغي',
};

const LEGACY_ENUM_TO_STATE_KEY = {
  'قيد التنفيذ': 'pending',
  'جاري التجهيز': 'preparing',
  'تم الشحن': 'dispatched',
  'تم التوصيل': 'delivered',
  'ملغي': 'cancelled',
  'تم التحصيل': 'collected',
  'مرتجع': 'returned',
};

const LEGACY_STATUS_TO_LABEL = {
  submitted: 'تم الإرسال',
  draft: 'مسودة',
  confirmed: 'تم التأكيد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  paid: 'مدفوع',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  rejected: 'مرفوض',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeWorkflowStateKey(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CANONICAL_LABELS, lower)) return lower;
  if (Object.prototype.hasOwnProperty.call(LEGACY_ENUM_TO_STATE_KEY, raw)) return LEGACY_ENUM_TO_STATE_KEY[raw];
  if (Object.prototype.hasOwnProperty.call(LEGACY_ENUM_TO_STATE_KEY, lower)) return LEGACY_ENUM_TO_STATE_KEY[lower];
  return null;
}

function createEmptyWorkflowRegistry() {
  return {
    loaded: false,
    loading: false,
    error: null,
    loadedAt: null,
    states: [],
    stateByKey: {},
    stateById: {},
    transitions: [],
    transitionsByFromKey: {},
    transitionCapabilities: [],
    capabilities: [],
    capabilityById: {},
    capabilityByKey: {},
  };
}

let registry = createEmptyWorkflowRegistry();

function buildWorkflowRegistry({ statesRows, transitionsRows, transitionCapabilityRows, capabilitiesRows }) {
  const states = Array.isArray(statesRows) ? statesRows.map((row) => {
    const stateKey = normalizeWorkflowStateKey(row.state_key) || normalizeText(row.state_key);
    return {
      ...row,
      state_key: stateKey,
      display_name: row.display_name || CANONICAL_LABELS[stateKey] || stateKey,
      is_initial: Boolean(row.is_initial),
      is_terminal: Boolean(row.is_terminal),
    };
  }).filter((row) => row.state_key) : [];

  const stateById = {};
  const stateByKey = {};
  for (const state of states) {
    if (state.id) stateById[state.id] = state;
    stateByKey[state.state_key] = state;
  }

  const capabilities = Array.isArray(capabilitiesRows) ? capabilitiesRows.map((row) => ({
    ...row,
    capability_key: normalizeText(row.capability_key),
    display_name: row.display_name || normalizeText(row.capability_key),
    domain_key: normalizeText(row.domain_key),
  })).filter((row) => row.capability_key) : [];

  const capabilityById = {};
  const capabilityByKey = {};
  for (const capability of capabilities) {
    if (capability.id) capabilityById[capability.id] = capability;
    capabilityByKey[capability.capability_key] = capability;
  }

  const transitionCapabilityMap = new Map();
  for (const row of Array.isArray(transitionCapabilityRows) ? transitionCapabilityRows : []) {
    const transitionId = normalizeText(row.transition_id);
    const capabilityId = normalizeText(row.capability_id);
    if (!transitionId || !capabilityId) continue;
    const list = transitionCapabilityMap.get(transitionId) || [];
    list.push(capabilityId);
    transitionCapabilityMap.set(transitionId, list);
  }

  const transitions = [];
  const transitionsByFromKey = {};
  for (const row of Array.isArray(transitionsRows) ? transitionsRows : []) {
    const fromState = row.from_state_id ? stateById[row.from_state_id] : null;
    const toState = row.to_state_id ? stateById[row.to_state_id] : null;
    if (!fromState || !toState) continue;

    const capabilityIds = transitionCapabilityMap.get(normalizeText(row.id)) || [];
    const capabilityKeys = capabilityIds
      .map((capabilityId) => capabilityById[capabilityId]?.capability_key || null)
      .filter(Boolean);

    const transition = {
      id: row.id,
      from_state_id: row.from_state_id,
      to_state_id: row.to_state_id,
      from_state_key: fromState.state_key,
      from_state_label: fromState.display_name,
      to_state_key: toState.state_key,
      to_state_label: toState.display_name,
      capability_ids: capabilityIds,
      capability_keys: capabilityKeys,
      capabilities: capabilityIds.map((capabilityId) => capabilityById[capabilityId]).filter(Boolean),
    };

    transitions.push(transition);
    const bucket = transitionsByFromKey[fromState.state_key] || [];
    bucket.push(transition);
    transitionsByFromKey[fromState.state_key] = bucket;
  }

  return {
    loaded: true,
    loading: false,
    error: null,
    loadedAt: new Date().toISOString(),
    states,
    stateByKey,
    stateById,
    transitions,
    transitionsByFromKey,
    transitionCapabilities: Array.isArray(transitionCapabilityRows) ? transitionCapabilityRows : [],
    capabilities,
    capabilityById,
    capabilityByKey,
  };
}

export async function loadWorkflowRuntime(api, { force = false } = {}) {
  if (registry.loaded && !force) {
    return getWorkflowSnapshot();
  }

  registry = {
    ...registry,
    loading: true,
    error: null,
  };

  const [statesRows, transitionsRows, transitionCapabilityRows, capabilitiesRows] = await Promise.all([
    api.get('workflow_states', {
      select: 'id,state_key,display_name,is_initial,is_terminal',
      order: 'display_name.asc',
    }).catch(() => []),
    api.get('workflow_transitions', {
      select: 'id,from_state_id,to_state_id',
    }).catch(() => []),
    api.get('workflow_transition_capabilities', {
      select: 'transition_id,capability_id',
    }).catch(() => []),
    api.get('capabilities', {
      select: 'id,capability_key,display_name,domain_key,is_active',
      order: 'display_name.asc',
    }).catch(() => []),
  ]);

  registry = buildWorkflowRegistry({
    statesRows,
    transitionsRows,
    transitionCapabilityRows,
    capabilitiesRows,
  });

  return getWorkflowSnapshot();
}

export function getWorkflowSnapshot() {
  return {
    loaded: registry.loaded,
    loading: registry.loading,
    error: registry.error,
    loadedAt: registry.loadedAt,
    states: registry.states.map((state) => ({ ...state })),
    transitions: registry.transitions.map((transition) => ({
      ...transition,
      capabilities: transition.capabilities.map((capability) => ({ ...capability })),
    })),
    transitionCapabilities: registry.transitionCapabilities.map((row) => ({ ...row })),
    capabilities: registry.capabilities.map((capability) => ({ ...capability })),
    stateByKey: Object.fromEntries(Object.entries(registry.stateByKey).map(([key, value]) => [key, { ...value }])),
    transitionsByFromKey: Object.fromEntries(Object.entries(registry.transitionsByFromKey).map(([key, value]) => [key, value.map((transition) => ({
      ...transition,
      capabilities: transition.capabilities.map((capability) => ({ ...capability })),
    }))])),
  };
}

export function getWorkflowStateLabel(stateKey) {
  const normalized = normalizeWorkflowStateKey(stateKey);
  if (!normalized) {
    return normalizeText(stateKey);
  }
  return registry.stateByKey[normalized]?.display_name || CANONICAL_LABELS[normalized] || normalized;
}

export function getAllowedTransitions(stateKey) {
  const normalized = normalizeWorkflowStateKey(stateKey) || normalizeText(stateKey);
  const transitions = registry.transitionsByFromKey[normalized] || [];
  return transitions.map((transition) => ({
    ...transition,
    capabilities: transition.capabilities.map((capability) => ({ ...capability })),
  }));
}

export function normalizeCapabilityList(userCapabilities = []) {
  const list = Array.isArray(userCapabilities)
    ? userCapabilities
    : typeof userCapabilities === 'string'
      ? userCapabilities.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

  return Array.from(new Set(list.map((value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') return normalizeText(value.capability_key || value.key || value.name);
    return '';
  }).filter(Boolean)));
}

export function canUserExecuteTransition(userCapabilities, transition) {
  const required = Array.isArray(transition?.capability_keys) ? transition.capability_keys : [];
  if (!required.length) return true;
  const owned = new Set(normalizeCapabilityList(userCapabilities));
  return required.some((capabilityKey) => owned.has(capabilityKey));
}

export function resolveWorkflowActions(order, session = {}) {
  const currentStateKey = normalizeWorkflowStateKey(order?.workflow_state_key || order?.workflow_status || order?.status) || 'pending';
  const allowedTransitions = getAllowedTransitions(currentStateKey);
  const capabilities = normalizeCapabilityList(session?.capabilities || session?.system_user?.capabilities || []);
  const executableTransitions = allowedTransitions.filter((transition) => canUserExecuteTransition(capabilities, transition));

  return {
    currentStateKey,
    currentStateLabel: getWorkflowStateLabel(currentStateKey),
    isTerminal: Boolean(registry.stateByKey[currentStateKey]?.is_terminal),
    isInitial: Boolean(registry.stateByKey[currentStateKey]?.is_initial),
    allowedTransitions: allowedTransitions.map((transition) => ({
      ...transition,
      canExecute: canUserExecuteTransition(capabilities, transition),
    })),
    executableTransitions,
    executableTransitionKeys: executableTransitions.map((transition) => transition.to_state_key),
    capabilities,
  };
}



export async function applyWorkflowTransition(api, orderId, nextStateKey, { legacyWorkflowStatus = null } = {}) {
  const normalized = normalizeWorkflowStateKey(nextStateKey);
  if (!normalized) {
    throw new Error('INVALID_WORKFLOW_STATE');
  }

  const payload = {
    workflow_state_key: normalized,
  };

  if (legacyWorkflowStatus) {
    payload.workflow_status = legacyWorkflowStatus;
  }

  const rows = await api.patch('orders', payload, {
    id: `eq.${String(orderId || '').trim()}`,
  });

  return Array.isArray(rows) && rows.length ? rows[0] : rows;
}
export function createWorkflowRuntimeFacade() {
  return {
    loadWorkflowRuntime,
    getWorkflowSnapshot,
    getWorkflowStateLabel,
    getAllowedTransitions,
    normalizeWorkflowStateKey,
    normalizeCapabilityList,
    canUserExecuteTransition,
    resolveWorkflowActions,
    applyWorkflowTransition,
  };
}
