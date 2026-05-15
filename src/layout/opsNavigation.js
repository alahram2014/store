export function hasCapability(session, capability) {
  if (!session) return false;

  const capabilities = Array.isArray(session.capabilities)
    ? session.capabilities
    : [];

  return capabilities.includes(capability);
}

export function resolveOperationalNavigation(session) {
  const items = [];

  if (hasCapability(session, 'dashboard.admin')) {
    items.push({
      key: 'admin',
      label: 'لوحة الإدارة',
      route: '/admin',
      icon: 'settings',
    });
  }

  if (hasCapability(session, 'dashboard.sales_manager')) {
    items.push({
      key: 'sales_manager',
      label: 'إدارة المبيعات',
      route: '/sales-manager',
      icon: 'users',
    });
  }

  if (hasCapability(session, 'dashboard.warehouse')) {
    items.push({
      key: 'warehouse',
      label: 'المخزن',
      route: '/warehouse',
      icon: 'package',
    });
  }

  if (hasCapability(session, 'dashboard.delivery')) {
    items.push({
      key: 'delivery',
      label: 'الشحن',
      route: '/delivery',
      icon: 'truck',
    });
  }

  if (hasCapability(session, 'dashboard.treasury')) {
    items.push({
      key: 'treasury',
      label: 'الخزنة',
      route: '/treasury',
      icon: 'wallet',
    });
  }

  if (hasCapability(session, 'dashboard.hr')) {
    items.push({
      key: 'hr',
      label: 'شؤون العاملين',
      route: '/hr',
      icon: 'briefcase',
    });
  }

  return items;
}
