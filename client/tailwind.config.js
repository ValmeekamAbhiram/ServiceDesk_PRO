/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Every colour resolves to a CSS variable declared in src/styles/index.css.
       * That indirection is what makes light/dark a single `data-theme` flip
       * instead of a `dark:` prefix on every element.
       */
      colors: {
        // surfaces
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--c-surface-sunken) / <alpha-value>)',
          inverse: 'rgb(var(--c-surface-inverse) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
          strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
        },
        // text
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--c-ink-subtle) / <alpha-value>)',
          inverse: 'rgb(var(--c-ink-inverse) / <alpha-value>)',
        },
        // brand + semantics (each has fg/bg/border/solid variants in CSS)
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-brand-600) / <alpha-value>)',
        },
        success: {
          fg: 'rgb(var(--c-success-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-success-bg) / <alpha-value>)',
          border: 'rgb(var(--c-success-border) / <alpha-value>)',
          solid: 'rgb(var(--c-success-solid) / <alpha-value>)',
        },
        warning: {
          fg: 'rgb(var(--c-warning-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-warning-bg) / <alpha-value>)',
          border: 'rgb(var(--c-warning-border) / <alpha-value>)',
          solid: 'rgb(var(--c-warning-solid) / <alpha-value>)',
        },
        danger: {
          fg: 'rgb(var(--c-danger-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-danger-bg) / <alpha-value>)',
          border: 'rgb(var(--c-danger-border) / <alpha-value>)',
          solid: 'rgb(var(--c-danger-solid) / <alpha-value>)',
        },
        info: {
          fg: 'rgb(var(--c-info-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-info-bg) / <alpha-value>)',
          border: 'rgb(var(--c-info-border) / <alpha-value>)',
          solid: 'rgb(var(--c-info-solid) / <alpha-value>)',
        },
        violet: {
          fg: 'rgb(var(--c-violet-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-violet-bg) / <alpha-value>)',
          border: 'rgb(var(--c-violet-border) / <alpha-value>)',
          solid: 'rgb(var(--c-violet-solid) / <alpha-value>)',
        },
        teal: {
          fg: 'rgb(var(--c-teal-fg) / <alpha-value>)',
          bg: 'rgb(var(--c-teal-bg) / <alpha-value>)',
          border: 'rgb(var(--c-teal-border) / <alpha-value>)',
          solid: 'rgb(var(--c-teal-solid) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['InterVariable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        card: '0.875rem',
        panel: '1.125rem',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(var(--c-shadow) / 0.05)',
        card: '0 1px 2px 0 rgb(var(--c-shadow) / 0.06), 0 1px 3px 0 rgb(var(--c-shadow) / 0.10)',
        raised: '0 4px 6px -1px rgb(var(--c-shadow) / 0.10), 0 2px 4px -2px rgb(var(--c-shadow) / 0.08)',
        pop: '0 12px 24px -6px rgb(var(--c-shadow) / 0.18), 0 4px 8px -4px rgb(var(--c-shadow) / 0.12)',
        focus: '0 0 0 3px rgb(var(--c-brand-500) / 0.28)',
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        sidebar: '16rem',
        'sidebar-collapsed': '4.25rem',
        topbar: '3.5rem',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--c-danger-solid) / 0.45)' },
          '70%': { boxShadow: '0 0 0 8px rgb(var(--c-danger-solid) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--c-danger-solid) / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'fade-in-up': 'fade-in-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      gridTemplateColumns: {
        'ticket-detail': 'minmax(0, 1fr) 22rem',
        'ticket-detail-wide': 'minmax(0, 1fr) 24rem',
      },
    },
  },
  plugins: [],
};
