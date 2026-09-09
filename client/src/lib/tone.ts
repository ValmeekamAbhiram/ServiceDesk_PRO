import type { Tone } from '@shared/labels';

/**
 * `Tone` (a semantic role from the shared contract) to the Tailwind classes that
 * paint it. One table, so a status badge and a KPI card cannot disagree about what
 * "warning" looks like, and so dark mode stays a single `data-theme` flip.
 */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted ring-line',
  primary: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
  info: 'bg-info-bg text-info-fg ring-info-border',
  success: 'bg-success-bg text-success-fg ring-success-border',
  warning: 'bg-warning-bg text-warning-fg ring-warning-border',
  danger: 'bg-danger-bg text-danger-fg ring-danger-border',
  violet: 'bg-violet-bg text-violet-fg ring-violet-border',
  teal: 'bg-teal-bg text-teal-fg ring-teal-border',
};

/** Solid fills, for progress bars and chart series. */
export const TONE_SOLID: Record<Tone, string> = {
  neutral: 'bg-line-strong',
  primary: 'bg-brand-600',
  info: 'bg-info-solid',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
  violet: 'bg-violet-solid',
  teal: 'bg-teal-solid',
};

/** The same roles as CSS variables, for Recharts — it needs a colour, not a class. */
export const TONE_VAR: Record<Tone, string> = {
  neutral: 'rgb(var(--c-line-strong))',
  primary: 'rgb(var(--c-brand-600))',
  info: 'rgb(var(--c-info-solid))',
  success: 'rgb(var(--c-success-solid))',
  warning: 'rgb(var(--c-warning-solid))',
  danger: 'rgb(var(--c-danger-solid))',
  violet: 'rgb(var(--c-violet-solid))',
  teal: 'rgb(var(--c-teal-solid))',
};
