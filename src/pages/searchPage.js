import { companyCard, productCard } from '../components/cards.js';
import { getSelectedTier, getVisibleProducts, getVisibleCompanies, normalize } from '../state/selectors.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSearchPage(state) {
  const tier = getSelectedTier(state);
  const q = normalize(state.ui.search);
  const products = q ? getVisibleProducts(state) : [];
  const companies = q ? getVisibleCompanies(state) : [];

  return `
    <div class="page-stack search-page">
      <section class="page-section search-page__bar">
        <div class="page-section__head page-section__head--tight">
          <div>
            <h2>البحث</h2>
            <p>ابحث عن منتج أو شركة أو قسم</p>
          </div>
          <button class="btn btn--ghost" type="button" data-action="go-back">رجوع</button>
        </div>
        <div class="search-page__input-row">
          <input id="searchInput" type="search" placeholder="ابحث باسم المنتج أو الشركة أو القسم" value="${escapeHtml(state.ui.search)}" dir="auto" autocomplete="off" />
          <button class="btn btn--ghost" type="button" data-action="clear-search">مسح</button>
        </div>
      </section>

      ${q ? `
        <section class="page-section">
          <div class="page-section__head page-section__head--tight"><div><h2>الشركات</h2><p>${companies.length} نتيجة</p></div></div>
          <div class="company-grid">${companies.map(companyCard).filter(Boolean).join('') || '<div class="empty-state">لا توجد شركات مطابقة</div>'}</div>
        </section>
        <section class="page-section">
          <div class="page-section__head page-section__head--tight"><div><h2>المنتجات</h2><p>${products.length} نتيجة</p></div></div>
          <div class="product-grid">${products.map((product) => productCard(product, tier, { unit: state.commerce.unitPrefs[product.product_id], qty: state.commerce.qtyPrefs[product.product_id] || 1, inCart: state.commerce.cart.some((item) => item.type === 'product' && item.id === product.product_id) })).join('') || '<div class="empty-state">لا توجد نتائج مطابقة</div>'}</div>
        </section>
      ` : `
        <section class="page-section">
          <div class="empty-state">ابدأ بالبحث لعرض النتائج</div>
        </section>
      `}
    </div>
  `;
}
