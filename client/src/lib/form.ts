/**
 * ServiceDesk Pro — server errors on a form.
 *
 * Every write in this app can come back with `VALIDATION_FAILED` and a list of
 * `{ path, message }`. Mapping those onto react-hook-form is the same three lines on
 * every page, and getting it subtly wrong is easy in one specific way: a message whose
 * path is not a control on this form gets stored by `setError` and then never rendered,
 * so the submit button goes quiet and the user is told nothing at all.
 *
 * So this returns a message for the form-level alert whenever *anything* was not
 * placed on a field, and `null` only when every message found a home.
 */

import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import { ApiClientError } from '@/lib/api';

const GENERIC = 'Something went wrong. Please try again.';

export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  form: UseFormReturn<T>,
  fields: readonly FieldPath<T>[]
): string | null {
  if (!(error instanceof ApiClientError)) return GENERIC;
  if (!error.isValidation) return error.message;

  let placed = 0;
  for (const detail of error.fields) {
    /* `items.0.assetId` belongs to the `items` control, so a prefix match counts. */
    const field = fields.find(
      (name) => detail.path === name || detail.path.startsWith(`${name}.`)
    );
    if (!field) continue;
    form.setError(field, { message: detail.message });
    placed += 1;
  }

  return placed === error.fields.length ? null : error.message;
}
