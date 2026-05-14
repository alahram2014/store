import { dom } from '../core/dom.js';
import { computeDisplayPrice, labelForUnit } from '../services/pricingService.js';
import { formatMoney } from '../services/invoiceService.js';

function toText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text;
}

function safeInitial(value, fallback = '•') {
  const text = toText(value, '');
  return text ? text.slice(0, 1) : fallback;
}

function safeDateLabel(value) {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return '—';
  }
}

export function companyCard(company) {
  const companyId = toText(company?.company_id);
  const companyName = toText(company?.company_name);
  if (!companyId || !companyName) {
    return '';
  }

  const companyLogo = toText(company?.company_logo);

  return `
    <article class="company-card" data-action="open-company" data-company-id="${dom.escape(companyId)}">
      <div class="company-card__logo">
        ${companyLogo
          ? `<img src="${dom.escape(companyLogo)}" alt="${dom.escape(companyName)}" loading="lazy" />`
          : `<span>${dom.escape(safeInitial(companyName))}</span>`
        }
      </div>

      <h3 class="company-card__title">
        ${dom.escape(companyName)}
      </h3>

      <button class="btn btn--ghost company-card__action" type="button">
        تصفح المنتجات
      </button>
    </article>
  `;
}

function renderUnitChips(product, selectedUnit) {
  const units = Array.isArray(product?._sortedUnits) ? product._sortedUnits : [];
  return units.map((unit) => {
    const unitCode = toText(unit?.unit_code);
    if (!unitCode) return '';
    const active = unitCode === selectedUnit;
    const disabled = unit?.runtime_healthy === false || unit?.is_sellable === false || unit?.unit_active === false || Number(unit?.final_price ?? 0) <= 0;
    return `<button class="unit-chip ${active ? 'is-active' : ''}" data-action="set-unit" data-product-id="${dom.escape(toText(product?.product_id))}" data-unit="${dom.escape(unitCode)}" ${disabled ? 'disabled' : ''}>${dom.escape(labelForUnit(unitCode))}</button>`;
  }).join('');
}

function formatTierMinimum(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)} مليون`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)} ألف`;
  }
  return `${n.toLocaleString('ar-EG')}`;
}

function getTierVisual(tier) {
  const label = String(tier?.visible_label || tier?.tier_name || '').toLowerCase();
  if (label.includes('الماس') || label.includes('diamond')) return { icon: '◆', description: 'أعلى أولوية تسعيرية' };
  if (label.includes('ذهب') || label.includes('gold')) return { icon: '⬢', description: 'مستوى مرتفع ومميز' };
  if (label.includes('فض') || label.includes('silver')) return { icon: '◈', description: 'توازن جيد للتوريد' };
  if (label.includes('برون') || label.includes('bronze')) return { icon: '⬡', description: 'نقطة بداية نمو' };
  return { icon: '○', description: 'المدخل الأساسي للحساب' };
}

export function productCard(product, tier, { unit, qty, inCart } = {}) {
  const productId = toText(product?.product_id);
  const productName = toText(product?.product_name);
  if (!productId || !productName) return '';

  const sortedUnits = Array.isArray(product?._sortedUnits)
    ? product._sortedUnits
    : Object.values(product?.units || {})
      .filter((item) => item?.unit_code)
      .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0) || String(a.unit_code).localeCompare(String(b.unit_code), 'ar'));
  product._sortedUnits = sortedUnits;

  const selectedUnit = toText(unit)
    || toText(product?.defaultUnit)
    || sortedUnits.map((u) => toText(u?.unit_code)).find((key) => Number(product?.units?.[key]?.final_price ?? 0) > 0)
    || 'carton';
  const display = computeDisplayPrice(product, selectedUnit, tier);
  const currentUnit = product?.units?.[selectedUnit] || null;
  const canBuy = product?.can_buy !== false && Number(currentUnit?.final_price ?? display.final ?? 0) > 0 && currentUnit?.unit_active !== false && currentUnit?.is_sellable !== false;
  const quantity = Math.max(1, Number(qty || 1));
  const image = toText(product?.product_image)
    ? `<img src="${dom.escape(product.product_image)}" alt="${dom.escape(productName)}" loading="lazy" />`
    : `<div class="product-card__image-fallback">${dom.escape(safeInitial(productName, 'P'))}</div>`;

  const ctaLabel = !canBuy ? (product?.availability_reason === 'missing_price' ? 'غير متاح حاليًا' : 'نفذت الكمية') : inCart ? 'إزالة من السلة' : 'شراء';

  return `
    <article class="product-card ${canBuy ? '' : 'product-card--disabled'}" data-product-id="${dom.escape(productId)}">
      <button class="product-card__media" data-action="open-product" data-product-id="${dom.escape(productId)}" type="button">${image}</button>
      <div class="product-card__body">
        <div class="product-card__title">${dom.escape(productName)}</div>
        <div class="product-card__meta">${dom.escape(toText(product?.company_name))}</div>
        <div class="product-card__price-row">
          <span class="price price--main">${formatMoney(display.final ?? 0)} ج.م</span>
          <span class="unit-label">${dom.escape(labelForUnit(selectedUnit))}</span>
        </div>
        <div class="qty-stepper ${inCart ? 'is-in-cart' : ''}">
          <button class="qty-stepper__btn" type="button" data-action="product-qty-down" data-product-id="${dom.escape(productId)}" aria-label="إنقاص الكمية">-</button>
          <label class="qty-field qty-field--inline">
            <span>الكمية</span>
            <input type="text" inputmode="numeric" pattern="[0-9]*" value="${String(quantity)}" data-role="product-qty" data-product-id="${dom.escape(productId)}" autocomplete="off" spellcheck="false" />
          </label>
          <button class="qty-stepper__btn" type="button" data-action="product-qty-up" data-product-id="${dom.escape(productId)}" aria-label="زيادة الكمية">+</button>
        </div>
        <div class="unit-group">${renderUnitChips(product, selectedUnit)}</div>
        <button class="btn btn--primary product-card__cta" type="button" data-action="toggle-product" data-product-id="${dom.escape(productId)}" ${canBuy ? '' : 'disabled'}>${ctaLabel}</button>
      </div>
    </article>
  `;
}

function countdownLabel(offerState, offer) {
  if (offerState?.status === 'active') return offerState.countdown || '--:--:--';
  if (offerState?.status === 'scheduled') return offerState.countdown || '--:--:--';
  if (offer?.countdown) return offer.countdown;
  return '--:--:--';
}

export function offerCard(offer, kind, inCart = false, offerState = null) {
  const id = Number(offer?.id);
  const title = toText(offer?.title || (kind === 'flash' ? 'عرض الساعة' : 'صفقة اليوم'));
  if (!Number.isFinite(id) || !title) return '';

  const runtimeStatus = String(offer.runtime_status || offer.status || '').trim().toLowerCase();
  const isFlash = kind === 'flash';
  const status = isFlash ? (runtimeStatus === 'active' ? 'متاح' : runtimeStatus === 'scheduled' ? 'قريبًا' : 'منتهي') : offer.can_buy ? 'متاح' : 'غير متاح';
  const cta = isFlash && runtimeStatus !== 'active' ? 'منتهي' : offer.can_buy === false ? 'غير متاح' : inCart ? 'إزالة من السلة' : (isFlash ? 'شراء الآن' : 'شراء');
  const countdown = isFlash ? countdownLabel(offerState, offer) : '';
  const details = toText(offer?.description || (isFlash ? 'عرض باكدج محدود ومخصص للتشغيل السريع' : 'عرض تشغيلي جاهز للشراء'));

  return `
    <article class="offer-card ${isFlash ? 'offer-card--flash' : 'offer-card--deal'} ${isFlash ? (runtimeStatus === 'active' ? 'is-active' : '') : ''}">
      ${isFlash ? `
        <div class="offer-card__hero">
          <div class="offer-card__hero-badge">عرض الساعة</div>
          <div class="offer-card__hero-timer">${dom.escape(countdown || '--:--:--')}</div>
          <div class="offer-card__hero-status ${runtimeStatus === 'active' ? 'is-on' : ''}">${dom.escape(status)}</div>
          <div class="offer-card__hero-meta">متاح للشراء طالما العداد يعمل</div>
        </div>
      ` : ''}
      <div class="offer-card__body offer-card__body--compact">
        <button class="offer-card__media" type="button" data-action="open-offer" data-offer-type="${kind}" data-id="${id}">
          ${toText(offer?.image)
            ? `<img src="${dom.escape(offer.image)}" alt="${dom.escape(title)}" loading="lazy" />`
            : `<div class="offer-card__image-fallback">${dom.escape(safeInitial(title, 'O'))}</div>`}
        </button>
        <div class="offer-card__content">
          <div class="offer-card__headline">
            <h3 class="offer-card__title">${dom.escape(title)}</h3>
            <span class="badge">${dom.escape(status)}</span>
          </div>
          <p class="offer-card__desc">${dom.escape(details)}</p>
          <div class="offer-card__pricebar">
            <strong class="offer-card__price">${dom.escape(formatMoney(offer?.price))} ج.م</strong>
            <button class="btn btn--primary offer-card__buy" type="button" data-action="${kind === 'deal' ? 'toggle-deal' : 'toggle-flash'}" data-id="${id}" ${isFlash && runtimeStatus !== 'active' ? 'disabled' : offer.can_buy === false ? 'disabled' : ''}>${cta}</button>
          </div>
          <button class="btn btn--ghost offer-card__details" type="button" data-action="open-offer" data-offer-type="${kind}" data-id="${id}">تفاصيل</button>
        </div>
      </div>
    </article>
  `;
}

export function tierCard(tier, active = false) {
  const tierName = toText(tier?.tier_name);
  if (!tierName) return '';
  const visual = getTierVisual(tier);
  return `
    <article class="tier-card ${active ? 'is-active' : ''}">
      <div class="tier-card__head">
        <div class="tier-card__icon" aria-hidden="true">${visual.icon}</div>
        <div class="tier-card__copy">
          <h3>${dom.escape(toText(tier?.visible_label || tierName))}</h3>
          <p>${dom.escape(visual.description)}</p>
        </div>
      </div>
      <div class="tier-card__summary">
        <div class="tier-card__summary-item">
          <span>الحد الأدنى</span>
          <strong>${dom.escape(formatTierMinimum(tier?.min_order || 0))}</strong>
        </div>
      </div>
      <button class="btn btn--primary" type="button" data-action="select-tier" data-tier-name="${dom.escape(tierName)}">${active ? 'إلغاء الاختيار' : 'اختيار'}</button>
    </article>
  `;
}

export function invoiceCard(invoice) {
  const invoiceId = toText(invoice?.id || invoice?.order_number || invoice?.invoice_number);
  if (!invoiceId) return '';
  return `
    <article class="invoice-card">
      <div class="invoice-card__top">
        <div>
          <h3>فاتورة #${dom.escape(toText(invoice?.order_number || invoice?.invoice_number || invoiceId))}</h3>
          <p>${dom.escape(safeDateLabel(invoice?.created_at))}</p>
          ${toText(invoice?.customer_name) ? `<p class="invoice-card__customer">${dom.escape(toText(invoice?.customer_name))}</p>` : ''}
        </div>
        <strong>${formatMoney(invoice?.total_amount || 0)} ج.م</strong>
      </div>
      <div class="invoice-card__meta">
        <span class="chip">${dom.escape(toText(invoice?.user_type || ''))}</span>
        <span class="chip">${dom.escape(toText(invoice?.status || ''))}</span>
        <button class="btn btn--ghost invoice-card__action" type="button" data-action="view-invoice" data-invoice-id="${dom.escape(invoiceId)}">عرض الفاتورة</button>
      </div>
    </article>
  `;
}

export function customerCard(customer, selected = false) {
  const customerId = toText(customer?.id);
  if (!customerId) return '';
  return `
    <article class="customer-card ${selected ? 'is-selected' : ''}" data-action="select-customer" data-customer-id="${dom.escape(customerId)}">
      <div class="customer-card__top">
        <div>
          <h3>${dom.escape(toText(customer?.name || ''))}</h3>
          <p>${dom.escape(toText(customer?.phone || 'بدون هاتف'))}</p>
        </div>
        ${selected ? `<span class="badge">مختار</span>` : ''}
      </div>
      <div class="customer-card__meta">
        <span class="chip">${dom.escape(toText(customer?.customer_type || 'direct'))}</span>
        ${customer?.sales_rep_id ? `<span class="chip">مندوب</span>` : ''}
      </div>
      <button class="btn btn--ghost customer-card__action" type="button">${selected ? 'تم الاختيار' : 'اختيار'}</button>
    </article>
  `;
}
