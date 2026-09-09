/**
 * Server validation errors landing on a form.
 *
 * The failure this module exists to prevent is silence: `setError` on a path that is not
 * a control on this form stores a message nothing renders, so the user presses Submit,
 * nothing happens, and no error appears anywhere. `applyServerErrors` therefore returns
 * `null` only when *every* message found a field, and a string for the form-level alert
 * otherwise. These tests pin that contract, because it is invisible in the UI when it
 * breaks — the symptom is a button that seems dead.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { ApiClientError } from '@/lib/api';
import { applyServerErrors } from '@/lib/form';

import { ErrorCode } from '@shared/enums';

const GENERIC = 'Something went wrong. Please try again.';

/** Just the one method `applyServerErrors` touches. */
function formStub<T extends FieldValues>() {
  const setError = vi.fn();
  return { form: { setError } as unknown as UseFormReturn<T>, setError };
}

function validationError(fields: { path: string; message: string }[]) {
  return new ApiClientError({
    code: ErrorCode.VALIDATION_FAILED,
    message: 'Please check the highlighted fields.',
    status: 422,
    fields,
  });
}

interface TicketForm extends FieldValues {
  title: string;
  priority: string;
  categoryId: string;
}

const FIELDS = ['title', 'priority', 'categoryId'] as const;

describe('applyServerErrors', () => {
  it('puts each message on its field and shows no form-level alert', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(
      validationError([
        { path: 'title', message: 'Title is required.' },
        { path: 'priority', message: 'Invalid value.' },
      ]),
      form,
      FIELDS
    );

    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenCalledWith('title', { message: 'Title is required.' });
    expect(setError).toHaveBeenCalledWith('priority', { message: 'Invalid value.' });
  });

  it('falls back to the form-level alert when a message has no field to land on', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(
      validationError([{ path: 'assetId', message: 'That asset is retired.' }]),
      form,
      FIELDS
    );

    /* The whole point: the user is told something, even though no control lit up. */
    expect(result).toBe('Please check the highlighted fields.');
    expect(setError).not.toHaveBeenCalled();
  });

  it('still alerts when only some of the messages were placed', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(
      validationError([
        { path: 'title', message: 'Too short.' },
        { path: 'attachments', message: 'Too many files.' },
      ]),
      form,
      FIELDS
    );

    expect(result).toBe('Please check the highlighted fields.');
    expect(setError).toHaveBeenCalledOnce();
  });

  it('routes a nested path to the control that owns it', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(
      validationError([{ path: 'categoryId.name', message: 'Unknown category.' }]),
      form,
      FIELDS
    );

    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledWith('categoryId', { message: 'Unknown category.' });
  });

  /* `categoryIdOther` starts with `categoryId` as a string but is a different control.
   * Only a `.` boundary counts as nesting. */
  it('does not treat a longer field name as a nested path', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(
      validationError([{ path: 'categoryIdOther', message: 'Nope.' }]),
      form,
      FIELDS
    );

    expect(result).toBe('Please check the highlighted fields.');
    expect(setError).not.toHaveBeenCalled();
  });

  it('shows a non-validation error message as it came from the server', () => {
    const { form, setError } = formStub<TicketForm>();
    const error = new ApiClientError({
      code: ErrorCode.VERSION_CONFLICT,
      message: 'This ticket was changed by someone else while you were editing.',
      status: 409,
    });

    expect(applyServerErrors(error, form, FIELDS)).toBe(
      'This ticket was changed by someone else while you were editing.'
    );
    expect(setError).not.toHaveBeenCalled();
  });

  /* A `VALIDATION_FAILED` with an empty `fields` array is not `isValidation`, so it takes
   * the same path as any other error: show the message, touch no control. */
  it('shows the message when validation failed with no field detail', () => {
    const { form, setError } = formStub<TicketForm>();
    const result = applyServerErrors(validationError([]), form, FIELDS);

    expect(result).toBe('Please check the highlighted fields.');
    expect(setError).not.toHaveBeenCalled();
  });

  it('never leaks a thrown value that is not an API error', () => {
    const { form, setError } = formStub<TicketForm>();

    expect(applyServerErrors(new TypeError('x.map is not a function'), form, FIELDS)).toBe(GENERIC);
    expect(applyServerErrors('boom', form, FIELDS)).toBe(GENERIC);
    expect(applyServerErrors(undefined, form, FIELDS)).toBe(GENERIC);
    expect(setError).not.toHaveBeenCalled();
  });
});
