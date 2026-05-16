const EVENT_HISTORY_LIMIT = 250;
const subscribers = new Map();
const history = [];

function normalizeEventType(eventType) {
  return String(eventType || '').trim() || 'event.unknown';
}

function createEventId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushHistory(event) {
  history.unshift(event);
  if (history.length > EVENT_HISTORY_LIMIT) {
    history.length = EVENT_HISTORY_LIMIT;
  }
}

function emit(eventType, event) {
  const handlers = new Set([
    ...(subscribers.get(eventType) || []),
    ...(subscribers.get('*') || []),
  ]);

  for (const handler of handlers) {
    try {
      handler(event);
    } catch (error) {
      console.error(`[domain-event:${eventType}]`, error);
    }
  }
}

export function publishDomainEvent(eventType, payload = {}, meta = {}) {
  const event = {
    id: createEventId(),
    type: normalizeEventType(eventType),
    payload: payload && typeof payload === 'object' ? { ...payload } : payload,
    meta: meta && typeof meta === 'object' ? { ...meta } : {},
    createdAt: new Date().toISOString(),
  };
  pushHistory(event);
  emit(event.type, event);
  return event;
}

export function subscribeDomainEvent(eventType, handler) {
  const key = normalizeEventType(eventType);
  const set = subscribers.get(key) || new Set();
  set.add(handler);
  subscribers.set(key, set);
  return () => {
    const current = subscribers.get(key);
    if (!current) return;
    current.delete(handler);
    if (!current.size) subscribers.delete(key);
  };
}

export function getDomainEventHistory(limit = EVENT_HISTORY_LIMIT) {
  const n = Math.max(0, Number(limit || 0));
  return history.slice(0, n || EVENT_HISTORY_LIMIT).map((event) => ({ ...event }));
}

export function clearDomainEventHistory() {
  history.length = 0;
}

export function createDomainEventFacade() {
  return {
    publishDomainEvent,
    subscribeDomainEvent,
    getDomainEventHistory,
    clearDomainEventHistory,
  };
}
