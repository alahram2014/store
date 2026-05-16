import { dom } from '../core/dom.js';

export const AVAILABLE_THEMES = [
  { name: 'vip-light-theme', label: 'بيج فاخر', icon: '☀', preview: 'linear-gradient(135deg, #fff7e8 0%, #f2d9a6 48%, #d9b56a 100%)' },
  { name: 'premium-dark', label: 'داكن فاخر', icon: '☾', preview: 'linear-gradient(135deg, #1a1714 0%, #0b0a09 100%)' },
  { name: 'white-theme', label: 'أبيض', icon: '◌', preview: 'linear-gradient(135deg, #ffffff 0%, #e9eef5 100%)' },
  { name: 'orange-theme', label: 'برتقالي', icon: '✦', preview: 'linear-gradient(135deg, #ffb347 0%, #ff7a00 100%)' },
  { name: 'sky-blue-theme', label: 'أزرق', icon: '☁', preview: 'linear-gradient(135deg, #8bd3ff 0%, #2b8cff 100%)' },
  { name: 'green-yellow-theme', label: 'أخضر', icon: '✿', preview: 'linear-gradient(135deg, #1fbf75 0%, #f3cf3c 100%)' },
  { name: 'amazon-inspired-theme', label: 'أمازون', icon: '⬣', preview: 'linear-gradient(135deg, #131a22 0%, #ff9900 100%)' },
];

export function renderThemeSwitcher(state) {
  if (state.app.route.name !== 'home') return '';

  return `
    <section class="theme-switcher" aria-label="اختيار الثيم">
      <div class="theme-switcher__label">الثيم</div>
      <div class="theme-switcher__row">
        ${AVAILABLE_THEMES.map((theme) => `
          <button
            type="button"
            class="theme-switcher__button ${state.ui.theme === theme.name ? 'is-active' : ''}"
            data-action="set-theme"
            data-theme="${dom.escape(theme.name)}"
            aria-label="${dom.escape(theme.label)}"
            aria-pressed="${state.ui.theme === theme.name ? 'true' : 'false'}"
            title="${dom.escape(theme.label)}"
            style="--theme-preview:${theme.preview};"
          >
            <span class="theme-switcher__icon" aria-hidden="true">${dom.escape(theme.icon)}</span>
          </button>
        `).join('')}
        <button class="theme-switcher__button theme-switcher__button--search" type="button" data-action="go-search" aria-label="البحث" title="البحث">
          <span class="theme-switcher__icon" aria-hidden="true">⌕</span>
        </button>
      </div>
    </section>
  `;
}
