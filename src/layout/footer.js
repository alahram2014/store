import { computeCartTotals, getSelectedTier } from '../state/selectors.js';
import { formatMoney } from '../services/invoiceService.js';

function formatFooterTotal(value) {
  const rounded = Math.round(Number(value || 0));
  return `${formatMoney(rounded)} ج.م`;
}

export function renderFooter(container, state) {
  const tier = getSelectedTier(state);
  const label = tier?.visible_label || tier?.tier_name || 'اختر شريحتك';
  const totals = computeCartTotals(state);

  container.innerHTML = `
    <nav class="footer-nav" aria-label="التنقل السفلي">
      <button type="button" data-action="navigate-home" class="footer-nav__item">الرئيسية</button>
      <button type="button" data-action="go-companies" class="footer-nav__item">الشركات</button>
      <div class="footer-nav__item footer-nav__item--total mono" aria-label="إجمالي السلة ${formatFooterTotal(totals.grand)}">${formatFooterTotal(totals.grand)}</div>
      <button type="button" data-action="open-cart-drawer" class="footer-nav__item footer-nav__item--strong">إتمام الشراء</button>
      <button type="button" data-action="go-tiers" class="footer-nav__item footer-nav__item--tier">${label}</button>
    </nav>
  `;
}
