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

export function buildWhatsAppInvoice({
  order,
  items,
  session,
  customer,
  tierLabel,
  supportWhatsapp,
}) {
  const actingCustomer = customer || session || {};

  const isManagedCustomer =
    actingCustomer?.customer_type === 'managed';

  const isSalesRepSession =
    session?.user_type === 'sales_rep';

  const isDelegatedOrder =
    isManagedCustomer && isSalesRepSession;

  let senderBlock = '';

  ```js
if (isDelegatedOrder) {
  senderBlock =
    'المندوب: ' +
    (session?.sales_rep_name || session?.name || 'غير محدد') +
    ' - ' +
    (session?.sales_rep_phone || session?.phone || 'غير محدد') +
    '\n\n' +
    'العميل: ' +
    (actingCustomer.name || '') +
    ' - ' +
    (actingCustomer.address || 'غير محدد') +
    ' - ' +
    (actingCustomer.phone || '') +
    '\n\n' +
    'لوكيشن العميل:\n' +
    (actingCustomer.location || 'غير محدد');
} else {
```


  let message = `طلب فاتورة شراء رقم ${order.order_number || order.invoice_number || order.id}

${senderBlock}

━━━━━━━━━━━━━━
بيان الطلب
`;

  for (const item of items) {
    message += `
${item.title || item.name || ''}
كود: ${item.id || item.product_id || ''} | الوحدة: ${item.unitLabel || item.unit || 'قطعة'}
الكمية: ${item.qty || 1} | السعر: ${formatMoney(item.price)} جنيه
الإجمالي: ${formatMoney(Number(item.qty || 0) * Number(item.price || 0))} جنيه

━━━━━━━━━━━━━━`;
  }

  message += `

إجمالي الفاتورة: ${formatMoney(order.total_amount)} جنيه`;

  return `https://wa.me/${supportWhatsapp}?text=${encodeURIComponent(message)}`;
}

export function formatMoney(value) {
  const n = Number(value ?? 0);

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
```
