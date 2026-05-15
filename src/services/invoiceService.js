import { isSalesRepSession } from './authService.js';

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

export function buildWhatsAppInvoice({ order, items, session, customer, tierLabel, supportWhatsapp }) {
  const actingCustomer = customer || session || {};

  const isRepManagedCustomer =
    actingCustomer?.customer_type === 'rep'
    && actingCustomer?.sales_rep_id;

  const senderBlock = `👤 بيانات المرسل
الاسم: ${actingCustomer.name || ''}
الهاتف: ${actingCustomer.phone || ''}

العنوان: ${actingCustomer.address || 'غير محدد'}
اللوكيشن: ${actingCustomer.location || 'غير محدد'}
`;

  const repDelegationBlock = isRepManagedCustomer
    ? `
━━━━━━━━━━━━━━
🧾 تم الإرسال نيابة عن

المندوب: ${session?.system_user?.full_name || session?.sales_rep_name || 'مندوب تابع'}
رقم المندوب: ${session?.system_user?.username || session?.sales_rep_phone || ''}
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
