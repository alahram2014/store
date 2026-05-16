import { dom } from '../core/dom.js';
import { computeCartTotals } from '../state/selectors.js';
import { formatMoney } from '../services/invoiceService.js';

const INELIGIBLE_ROUTES = new Set(['ops', 'sales-manager', 'checkout', 'login', 'register', 'invoice']);

export function shouldRenderFloatingExecutionBar(state = {}) {
  const routeName = state?.app?.route?.name || 'home';
  return !INELIGIBLE_ROUTES.has(routeName);
}

export function renderFloatingExecutionBar(state = {}) {
  if (!shouldRenderFloatingExecutionBar(state)) return '';

  const search = String(state?.ui?.search || '');
  const totals = computeCartTotals(state);
  const totalText = `${formatMoney(Number(totals.grand || 0))} ج.م`;

  return `
    <div class="floating-execution-bar__shell" data-role="floating-execution-shell">
      <input
        class="floating-execution-bar__search"
        type="search"
        data-role="floating-search-input"
        placeholder="ابحث"
        value="${dom.escape(search)}"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        dir="auto"
      />
      <button class="floating-execution-bar__total" type="button" data-action="go-checkout" aria-label="الانتقال إلى إتمام الطلب">${dom.escape(totalText)}</button>
    </div>
  `;
}
