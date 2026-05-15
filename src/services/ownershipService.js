export function normalizeOwnershipId(value) {
  return String(value ?? '').trim();
}

export function normalizeOwnershipType(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function buildGoogleMapsUrl(lat, lng, locationText = '') {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `https://maps.google.com/?q=${latitude},${longitude}`;
  }
  const text = String(locationText || '').trim();
  return text ? `https://maps.google.com/?q=${encodeURIComponent(text)}` : '';
}

export function customerHasOwnership(customer, ownerId) {
  const normalizedOwnerId = normalizeOwnershipId(ownerId);
  if (!normalizedOwnerId) return false;
  if (!customer || typeof customer !== 'object') return false;

  const fields = [
    customer.sales_rep_id,
    customer.rep_id,
    customer.created_by_rep_id,
    customer.created_by,
  ];

  return fields.some((value) => normalizeOwnershipId(value) === normalizedOwnerId);
}

export function isRepManagedCustomer(customer) {
  if (!customer || typeof customer !== 'object') return false;
  const type = normalizeOwnershipType(customer.customer_type);
  if (type === 'rep') return true;
  if (type === 'direct') return false;
  return Boolean(customer.sales_rep_id || customer.rep_id || customer.created_by_rep_id);
}

export function isDirectCustomer(customer) {
  if (!customer || typeof customer !== 'object') return false;
  const type = normalizeOwnershipType(customer.customer_type);
  if (type === 'direct') return true;
  if (type === 'rep') return false;
  return !isRepManagedCustomer(customer);
}

export function projectCustomerOwnership(customer = {}) {
  const customerType = normalizeOwnershipType(customer.customer_type) || (isRepManagedCustomer(customer) ? 'rep' : 'direct');
  const locationLat = customer.location_lat ?? null;
  const locationLng = customer.location_lng ?? null;
  const location = String(customer.location || '').trim();
  return {
    ...customer,
    customer_type: customerType || 'direct',
    ownership_kind: customerType === 'rep' ? 'rep-managed' : 'direct',
    google_maps_url: buildGoogleMapsUrl(locationLat, locationLng, location),
    location_display: location || (Number.isFinite(Number(locationLat)) && Number.isFinite(Number(locationLng))
      ? `${Number(locationLat).toFixed(6)}, ${Number(locationLng).toFixed(6)}`
      : ''),
  };
}

export function resolveSalesRepProjection(session = {}) {
  return {
    sales_rep_name: session?.system_user?.full_name || session?.sales_rep_name || session?.name || '',
    sales_rep_phone: session?.system_user?.username || session?.sales_rep_phone || session?.phone || '',
  };
}

export function projectInvoiceRuntimeRecord(invoice = {}, { customer = null, session = null } = {}) {
  const repProjection = resolveSalesRepProjection(session || {});
  const customerType = normalizeOwnershipType(invoice.customer_type || customer?.customer_type || '');
  const locationLat = invoice.customer_location_lat ?? customer?.location_lat ?? invoice.location_lat ?? null;
  const locationLng = invoice.customer_location_lng ?? customer?.location_lng ?? invoice.location_lng ?? null;
  const location = String(invoice.customer_location || invoice.location || customer?.location || '').trim();
  const customerName = invoice.customer_name || customer?.name || session?.name || session?.username || '';
  const customerPhone = invoice.customer_phone || customer?.phone || session?.phone || '';
  const googleMapsUrl = buildGoogleMapsUrl(locationLat, locationLng, location);

  return {
    ...invoice,
    customer_type: customerType || invoice.customer_type || (isRepManagedCustomer(customer) ? 'rep' : 'direct'),
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_location: location,
    customer_location_lat: locationLat ?? null,
    customer_location_lng: locationLng ?? null,
    customer_google_maps_url: googleMapsUrl,
    sales_rep_name: invoice.sales_rep_name || repProjection.sales_rep_name || '',
    sales_rep_phone: invoice.sales_rep_phone || repProjection.sales_rep_phone || '',
    sent_on_behalf_of: invoice.sent_on_behalf_of
      || ((normalizeOwnershipType(invoice.customer_type || customer?.customer_type || '') === 'rep')
        ? (repProjection.sales_rep_name || 'مندوب')
        : ''),
    invoice_label: invoice.invoice_label || `فاتورة #${invoice.order_number || invoice.invoice_number || invoice.id || ''}`,
  };
}
