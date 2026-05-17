```js id="m3vlyf"
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

  const isRepManagedCustomer = Boolean(
    actingCustomer && actingCustomer.sales_rep_id
  );

  let senderBlock = '';

  if (isRepManagedCustomer) {
    senderBlock =
      'بيانات المندوب\n' +
      'الاسم: ' +
      (session?.system_user?.full_name ||
        session?.sales_rep_name ||
        'غير محدد') +
      '\n' +
      'الهاتف: ' +
      (session?.system_user?.username ||
        session?.sales_rep_phone ||
        'غير محدد') +
      '\n\n' +
      '━━━━━━━━━━━━━━\n' +
      'بيانات العميل\n' +
      'الاسم: ' +
      (actingCustomer.name || '') +
      '\n' +
      'الهاتف: ' +
      (actingCustomer.phone || '') +
      '\n\n' +
      'العنوان: ' +
      (actingCustomer.address || 'غير محدد') +
      '\n' +
      'اللوكيشن: ' +
      (actingCustomer.location || 'غير محدد');
  } else {
    senderBlock =
      'بيانات العميل\n' +
      'الاسم: ' +
      (actingCustomer.name || '') +
      '\n' +
      'الهاتف: ' +
      (actingCustomer.phone || '') +
      '\n\n' +
      'العنوان: ' +
      (actingCustomer.address || 'غير محدد') +
      '\n' +
      'اللوكيشن: ' +
      (actingCustomer.location || 'غير محدد');
  }

  let message =
    'فاتورة طلب شراء\n\n' +
    'رقم الفاتورة: ' +
    (order.order_number || order.invoice_number || order.id) +
    '\n\n' +
    '━━━━━━━━━━━━━━\n' +
    senderBlock +
    '\n━━━━━━━━━━━━━━\n\n' +
    'الشريحة\n' +
    (tierLabel || 'base') +
    '\n\n━━━━━━━━━━━━━━\n\n' +
    'تفاصيل الطلب\n';

  for (const item of items) {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    const total = qty * price;

    message +=
      '\n' +
      (item.title || item.name || '') +
      '\n\n' +
      'كود: ' +
      (item.id || item.product_id || '') +
      '\n' +
      'الوحدة: ' +
      (item.unitLabel || item.unit || 'قطعة') +
      '\n' +
      'الكمية: ' +
      qty +
      '\n' +
      'سعر الوحدة: ' +
      formatMoney(price) +
      ' جنيه\n' +
      'الإجمالي: ' +
      formatMoney(total) +
      ' جنيه\n\n' +
      '━━━━━━━━━━━━━━\n';
  }

  message +=
    '\nإجمالي الفاتورة:\n' +
    formatMoney(order.total_amount) +
    ' جنيه';

  return (
    'https://wa.me/' +
    supportWhatsapp +
    '?text=' +
    encodeURIComponent(message)
  );
}

export function formatMoney(value) {
  const n = Number(value ?? 0);

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
```
