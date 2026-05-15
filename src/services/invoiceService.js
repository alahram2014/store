import { buildGoogleMapsUrl, isRepManagedCustomer, resolveSalesRepProfileById } from './ownershipService.js';

const STATUS_MAP = {
  draft: 'مسودة',
  pending: 'قيد التنفيذ',
  confirmed: 'تم التأكيد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  paid: 'مدفوع',
  submitted: 'تم الإرسال',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  rejected: 'مرفوض',
};

export function formatStatus(status) {
  return STATUS_MAP[String(status || '').trim()] || String(status || 'غير معروف');
}

export function persistInvoices(invoices) {
  void invoices;
}

export async function buildWhatsAppInvoice({ api, order, items, session, customer, tierLabel, supportWhatsapp }) {
  const actingCustomer = customer || session || {};
  const mapsUrl = buildGoogleMapsUrl(
    actingCustomer?.location_lat ?? actingCustomer?.customer_location_lat ?? null,
    actingCustomer?.location_lng ?? actingCustomer?.customer_location_lng ?? null,
    actingCustomer?.location || actingCustomer?.customer_location || '',
  );

  const repProfile = await resolveSalesRepProfileById(
    api,
    order?.sales_rep_id || actingCustomer?.sales_rep_id || session?.sales_rep_id || order?.rep_id || actingCustomer?.rep_id || session?.rep_id || order?.created_by_rep_id || actingCustomer?.created_by_rep_id || session?.created_by_rep_id || '',
  ).catch(() => null);
  const isRepManaged = isRepManagedCustomer(actingCustomer)
    || String(actingCustomer?.customer_type || '').trim().toLowerCase() === 'rep'
    || Boolean(order?.sales_rep_id);

  const senderBlock = `👤 بيانات العميل
الاسم: ${actingCustomer.name || ''}
الهاتف: ${actingCustomer.phone || ''}

العنوان: ${actingCustomer.address || 'غير محدد'}
الموقع: ${mapsUrl || actingCustomer.location || actingCustomer.customer_location || 'غير محدد'}
`;

  const repDelegationBlock = isRepManaged
    ? `
━━━━━━━━━━━━━━
🧾 تم الإرسال نيابة عن

المندوب: ${repProfile.name || session?.system_user?.full_name || 'مندوب تابع'}
رقم المندوب: ${repProfile.phone || session?.system_user?.username || ''}
`
    : '';

  let message = `📦 فاتورة طلب شراء

رقم الفاتورة: ${order.order_number || order.invoice_number || order.id}

━━━━━━━━━━━━━━
${senderBlock}${repDelegationBlock}
━━━━━━━━━━━━━━

🏷️ الشريحة
${tierLabel || 'base'}

━━━━━━━━━━━━━━

🛒 تفاصيل الطلب
`;

  for (const item of items) {
    message += `
📦 ${item.title || item.name || ''}

كود: ${item.id || item.product_id || ''}
الوحدة: ${item.unitLabel || item.unit || 'قطعة'}
سعر الوحدة: ${formatMoney(item.price)} جنيه
الكمية: ${item.qty || 1}
الإجمالي: ${formatMoney(Number(item.qty || 0) * Number(item.price || 0))} جنيه

━━━━━━━━━━━━━━
`;
  }

  message += `
💰 إجمالي الفاتورة:
${formatMoney(order.total_amount)} جنيه
`;

  return `https://wa.me/${supportWhatsapp}?text=${encodeURIComponent(message)}`;
}
export function formatMoney(value) {
  const n = Number(value ?? 0);

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
