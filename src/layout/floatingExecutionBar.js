import { dom } from '../core/dom.js';
import { computeCartTotals } from '../state/selectors.js';
import { formatMoney } from '../services/invoiceService.js';

const INELIGIBLE_ROUTES = new Set(['ops', 'sales-manager', 'login', 'register', 'invoice']);

export function shouldRenderFloatingExecutionBar(state = {}) {
  const routeName = state?.app?.route?.name || 'home';
  return !INELIGIBLE_ROUTES.has(routeName);
}

export function renderFloatingExecutionBar(state = {}) {
  if (!shouldRenderFloatingExecutionBar(state)) return '';

  const totals = computeCartTotals(state);
  const totalText = `${formatMoney(Number(totals.grand || 0))} ج.م`;

  return `
    <button class="floating-execution-bar__shell" type="button" data-action="go-checkout" aria-label="الانتقال إلى إرسال الطلب">
      <span class="floating-execution-bar__total">${dom.escape(totalText)}</span>
    </button>
  `;
}
