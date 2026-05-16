import { companyCard, productCard } from '../components/cards.js';
import { normalize, getVisibleCompanies } from '../state/selectors.js';

function shelf(title, subtitle, itemsHtml, extraClass = '', gridClass = 'section-grid') {
  return `
    <section class="page-section page-section--dense ${extraClass}">
      <div class="page-section__head page-section__head--tight">
        <div>
          <h2>${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
      </div>
      <div class="${gridClass}">${itemsHtml}</div>
    </section>
  `;
}

function skeletonGrid(count = 6, type = 'product') {
  return Array.from({ length: count }).map((_, index) => `
    <article class="${type === 'company' ? 'company-card' : 'product-card'} is-skeleton" aria-hidden="true">
      <div class="skeleton-box skeleton-box--media"></div>
      <div class="skeleton-box skeleton-box--line"></div>
      <div class="skeleton-box skeleton-box--line"></div>
      <div class="skeleton-box skeleton-box--line short"></div>
    </article>
  `).join('');
}

function pickProducts(state, list) {
  const q = normalize(state.ui.search);
  return (list || []).filter((product) => {
    if (!product) return false;
    if (!q) return true;
    return normalize(product.product_name).includes(q)
      || normalize(product.company_name).includes(q)
      || normalize(product.product_id).includes(q)
      || normalize(product.company_id).includes(q);
  });
}

function productsByIds(state, ids) {
  const map = state.commerce.catalog.productIndex || {};
  return ids.map((id) => map[String(id)]).filter(Boolean);
}

function topCompanyCards(state) {
  return getVisibleCompanies(state)
    .map(companyCard)
    .join('');
}

function productSkeletons(count = 4) {
  return skeletonGrid(count, 'product');
}

function renderProductShelf(title, subtitle, products, tier, state, loading = false) {
  const items = products.length
    ? products.map((product) => productCard(product, tier, {
      unit: state.commerce.unitPrefs[product.product_id],
      qty: state.commerce.qtyPrefs[product.product_id] || 1,
      inCart: state.commerce.cart.some((item) => item.type === 'product' && item.id === product.product_id),
    })).join('')
    : loading ? productSkeletons(8) : '';
  return items ? shelf(title, subtitle, items, 'page-section--products', 'product-grid') : '';
}

export function renderHomePage(state) {
  const catalogReady = Boolean(state.runtime.lifecycle?.catalogReady);
  const q = normalize(state.ui.search);
  const companies = getVisibleCompanies(state).filter((company) => {
    if (!q) return true;
    return normalize(company.company_name).includes(q) || normalize(company.company_id).includes(q);
  });

  const tier = state.commerce.selectedTier
    ? state.commerce.catalog.tiers?.find((item) => item.tier_name === state.commerce.selectedTier) || state.commerce.catalog.tiers?.[0]
    : state.commerce.catalog.tiers?.[0];
  const topProductsMeta = state.commerce.catalog.top?.products || [];
  const topProductIds = topProductsMeta.map((row) => row.product_id);
  const topProducts = productsByIds(state, topProductIds);
  const cartCompanyIds = new Set((state.commerce.cart || []).map((item) => String(item.companyId || item.company_id || '')));
  const basketProducts = topProducts.filter((product) => cartCompanyIds.has(String(product.company_id || '')) || (state.commerce.cart || []).some((item) => String(item.id) === String(product.product_id))).slice(0, 8);
  const featuredProducts = topProducts.slice(0, 8);
  const mostRequested = topProductIds.slice(0, 8).map((id) => topProducts.find((product) => String(product.product_id) === String(id))).filter(Boolean);
  const smartProducts = [...topProducts].filter((product) => !basketProducts.includes(product)).slice(0, 8);
  const productLoading = catalogReady && topProductIds.length > 0 && topProducts.length === 0;

  if (!catalogReady) {
    return `
      <div class="page-stack">
        ${shelf('جارٍ التحميل', 'يتم تجهيز الشركات', skeletonGrid(4, 'company'), 'page-section--products', 'company-grid')}
        ${shelf('جارٍ التحميل', 'يتم تجهيز الملخصات', productSkeletons(6), 'page-section--products', 'product-grid')}
      </div>
    `;
  }

  return `
    <div class="page-stack">
      ${companies.length ? shelf('الشركات', 'شبكة التوريد الرئيسية', topCompanyCards(state), 'page-section--companies', 'company-grid') : ''}
      ${renderProductShelf('الأكثر مبيعًا', 'أهم الأصناف المتاحة حاليًا', featuredProducts, tier, state, productLoading)}
      ${renderProductShelf('الأكثر طلبًا', 'الأصناف الأكثر تداولًا', mostRequested, tier, state, productLoading)}
      ${renderProductShelf('منتجات تناسب سلتك', 'اقتراحات مبنية على الطلب الحالي', basketProducts, tier, state)}
      ${renderProductShelf('الترشيحات الذكية', 'أصناف جاهزة للشراء السريع', smartProducts, tier, state)}
    </div>
  `;
}
