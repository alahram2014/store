import { companyCard } from '../components/cards.js';
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
  return Array.from({ length: count }).map(() => `
    <article class="${type === 'company' ? 'company-card' : 'product-card'} is-skeleton" aria-hidden="true">
      <div class="skeleton-box skeleton-box--media"></div>
      <div class="skeleton-box skeleton-box--line"></div>
      <div class="skeleton-box skeleton-box--line"></div>
      <div class="skeleton-box skeleton-box--line short"></div>
    </article>
  `).join('');
}

export function renderHomePage(state) {
  const catalogReady = Boolean(state.runtime.lifecycle?.catalogReady);
  const q = normalize(state.ui.search);
  const companies = getVisibleCompanies(state).filter((company) => {
    if (!q) return true;
    return normalize(company.company_name).includes(q) || normalize(company.company_id).includes(q);
  });

  if (!catalogReady) {
    return `
      <div class="page-stack">
        ${shelf('جارٍ التحميل', 'يتم تجهيز الشركات', skeletonGrid(6, 'company'), 'page-section--companies', 'company-grid')}
      </div>
    `;
  }

  return `
    <div class="page-stack">
      ${companies.length ? shelf('الشركات', 'اختر الشركة ثم اعرض المنتجات', companies.map(companyCard).join(''), 'page-section--companies', 'company-grid') : shelf('لا توجد شركات', 'لم يتم العثور على شركات مطابقة', '<div class="empty-state">لا توجد شركات متاحة</div>', 'page-section--companies', 'company-grid')}
    </div>
  `;
}
