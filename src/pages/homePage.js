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

function skeletonGrid(count = 6, type = 'company') {
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
  const previewCompanies = companies.slice(0, 12);
  const companyCount = Array.isArray(state.commerce.catalog.companies) ? state.commerce.catalog.companies.length : 0;

  if (!catalogReady) {
    return `
      <div class="page-stack page-stack--home">
        <section class="page-section home-launcher home-launcher--skeleton">
          <div class="home-launcher__eyebrow">تحميل الشركات</div>
          <h2>جارٍ تجهيز دليل التوريد</h2>
          <p>سيظهر هنا فقط ما تحتاجه للانتقال السريع إلى الشركة ثم المنتجات.</p>
        </section>
        ${shelf('الشركات', 'تحميل خفيف بدون كتالوجات إضافية', skeletonGrid(6, 'company'), 'page-section--companies', 'company-grid')}
      </div>
    `;
  }

  return `
    <div class="page-stack page-stack--home">
      <section class="page-section home-launcher">
        <div class="home-launcher__eyebrow">شركة أولًا · تشغيل خفيف</div>
        <h2>اختر الشركة ثم افتح المنتجات مباشرة</h2>
        <p>${companyCount} شركة متاحة للعرض السريع، مع تقليل أي تحميل غير ضروري في الصفحة الرئيسية.</p>
      </section>
      ${shelf('الشركات', 'شبكة التوريد الرئيسية', previewCompanies.map(companyCard).join('') || '<div class="empty-state">لا توجد شركات مطابقة</div>', 'page-section--companies', 'company-grid')}
    </div>
  `;
}
