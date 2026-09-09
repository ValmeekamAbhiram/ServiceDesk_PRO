/**
 * ServiceDesk Pro — telling a populated reference from a bare id.
 *
 * Mongoose hands a `ref` field back in one of two shapes depending on whether the
 * query asked for it: an `ObjectId`, or the document it points at. Both are objects at
 * runtime, so `typeof` cannot separate them, and a mapper that guesses wrong writes a
 * raw id into a field the client will render as somebody's name.
 *
 * The test is therefore a *marker field* — something the target document has and an
 * `ObjectId` does not. A query that forgot its `populate()` then renders `null`, which
 * shows up immediately as a missing name, instead of leaking an id into the UI.
 *
 * This lives in `utils` rather than beside any one mapper because ticket, asset and
 * article mapping all need it. Three private copies of a three-line predicate is three
 * chances for one of them to drift.
 */

import type { Types } from 'mongoose';

/** A reference as it arrives from Mongoose: an id, or the document it points at. */
export type Populated<T> = T | Types.ObjectId | null | undefined;

/**
 * `marker` is a field the target document has and an `ObjectId` does not. Pick one that
 * is always selected — `name`, `tag` — not an optional field, or a document that
 * happens to omit it reads as unpopulated.
 */
export function populatedDoc<T extends object>(value: Populated<T>, marker: keyof T): T | null {
  if (!value || typeof value !== 'object') return null;
  return marker in value ? (value as T) : null;
}
