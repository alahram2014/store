import { getWorkflowStateLabel, normalizeWorkflowStateKey } from './workflowService.js';

const STATUS_MAP = {
  draft: 'مسودة',
  pending: 'طلب جديد',
  reviewing: 'تحت المراجعة',
  preparing: 'جاري التحضير',
  dispatched: 'خرج للشحن',
  delivered: 'تم التسليم',
  collected: 'تم التحصيل',
  returned: 'مرتجع',
  cancelled: 'ملغي',
  draft_order: 'مسودة',
  confirmed: 'تم التأكيد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  paid: 'مدفوع',
  submitted: 'تم الإرسال',
  completed: 'مكتمل',
  rejected: 'مرفوض',
};

export function formatStatus(status) {
  const normalizedWorkflow = normalizeWorkflowStateKey(status);
  if (normalizedWorkflow) {
    return getWorkflowStateLabel(normalizedWorkflow);
  }
  const key = String(status || '').trim().toLowerCase();
  return STATUS_MAP[key] || String(status || 'غير معروف');
}

export function persistInvoices(invoices) {
  void invoices;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function resolveCustomerLocation(customer = {}) {
  const lat = customer?.location_lat ?? customer?.lat ?? customer?.latitude ?? '';
  const lng = customer?.location_lng ?? customer?.lng ?? customer?.longitude ?? '';
  if (lat === '' && lng === '') return normalizeText(customer?.location || customer?.address || 'غير محدد');
  return `${normalizeText(lat)}, ${normalizeText(lng)}`.trim();
}

function resolveRepActor(session = {}) {
  return {
    name: normalizeText(session?.system_user?.full_name || session?.sales_rep_name || session?.name || 'مندوب'),
    phone: normalizeText(session?.system_user?.username || session?.sales_rep_phone || session?.phone || ''),
  };
}

function resolveCustomerActor(customer = {}) {
  return {
    name: normalizeText(customer?.name || customer?.customer_name || 'عميل'),
    phone: normalizeText(customer?.phone || ''),
    area: normalizeText(customer?.area || customer?.address || customer?.location || 'غير محدد'),
  };
}

function renderSenderSection({ session, customer }) {
  const rep = resolveRepActor(session);
  const buyer = resolveCustomerActor(customer);
  const customerType = normalizeText(customer?.customer_type || session?.customer_type || '').toLowerCase();
  const hasRepAssignment = Boolean(customer?.sales_rep_id || session?.sales_rep_id || session?.rep_id);

  if (customerType === 'direct' || (!hasRepAssignment && customerType !== 'managed')) {
    return `العميل: ${buyer.name} - ${buyer.phone}`;
  }

  return [
    `المندوب: ${rep.name} - ${rep.phone}`,
    `العميل: ${buyer.name} - ${buyer.area} - ${buyer.phone}`,
  ].join('\n');
}

function renderInvoiceItem(item) {
  const name = normalizeText(item?.product_name || item?.title || item?.name || '');
  const code = normalizeText(item?.code || item?.sku || item?.id || item?.product_id || '');
  const unit = normalizeText(item?.unitLabel || item?.unit || 'قطعة');
  const qty = Number(item?.qty || 1);
  const price = Number(item?.price || 0);
  const total = qty * price;
  return `${name}\nكود: ${code} | الوحدة: ${unit}\nالكمية: ${qty} | السعر: ${formatMoney(price)}\nالإجمالي: ${formatMoney(total)}`;
}

export function buildWhatsAppInvoice({ order, items, session, customer, tierLabel, supportWhatsapp }) {
  const buyer = customer || session || {};
  const senderSection = renderSenderSection({ session, customer: buyer });
  const locationText = resolveCustomerLocation(buyer);

  let message = `طلب فاتورة شراء رقم ${order.order_number || order.invoice_number || order.id}\n\n${senderSection}\nلوكيشن العميل:\n${locationText}\n\n━━━━━━━━━━━━━━\nبيان الطلب\n\n`;

  for (const item of items) {
    message += `${renderInvoiceItem(item)}\n\n`;
  }

  message += `━━━━━━━━━━━━━━\nإجمالي الفاتورة: ${formatMoney(order.total_amount)}\n\n${tierLabel ? `الشريحة: ${tierLabel}` : ''}`.trim();

  return `https://wa.me/${supportWhatsapp}?text=${encodeURIComponent(message)}`;
}

export function formatMoney(value) {
  const n = Number(value ?? 0);

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
