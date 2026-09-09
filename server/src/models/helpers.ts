/**
 * ServiceDesk Pro — shared model plumbing.
 *
 * Every schema in `models/` is built from these pieces so that optimistic
 * concurrency, timestamps, sequence numbering and enum validation behave
 * identically across all ~24 collections instead of being re-invented per file.
 */

import mongoose, { Schema, type Model, type SchemaOptions, type SchemaTypeOptions } from 'mongoose';

/**
 * `strict: true` (Mongoose's default, made explicit here) is a security
 * property, not just hygiene: any field the client sends that is not declared in
 * the schema is silently dropped rather than persisted. A request body carrying
 * `{"role":"SYSTEM_ADMIN"}` at a route that only declares profile fields cannot
 * write it, even if a controller forwards the body wholesale.
 *
 * `versionKey: false` disables Mongoose's `__v`. We keep our own `version` field
 * instead — it is part of the wire contract (`TicketDto.version`) and the client
 * echoes it back for conflict detection, so it needs a name we control.
 */
export const BASE_SCHEMA_OPTIONS: SchemaOptions<any> = {
  timestamps: true,
  versionKey: false,
  strict: true,
  minimize: false,
  id: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
};

/**
 * Return type of the field factories below.
 *
 * `any` in the value slot is deliberate and worth explaining, because it looks
 * like laziness. `SchemaTypeOptions<T>` is *contravariant* in `T` — it carries
 * `transform(val: T)`, `set(val: T)` and `validate` — so a factory that returns
 * `SchemaTypeOptions<ObjectId>` cannot be assigned to a field the document
 * interface declares as `ObjectId | null`, which is how every optional reference
 * in this codebase is typed. TypeScript is right; the constraint is simply
 * useless here, since the factory hardcodes the runtime type and there is
 * nothing left for the checker to catch.
 *
 * Fields written out longhand (`{ type: String, maxlength: 120 }`) keep their
 * full checking against the document interface — that is the majority of every
 * schema, and where a genuine mismatch would actually be caught. Only these
 * three factories opt out.
 */
export type FieldDef = SchemaTypeOptions<any>;

/** `ObjectId` reference field, with the index that almost every ref wants. */
export function ref(target: string, options: Partial<FieldDef> = {}): FieldDef {
  return {
    type: Schema.Types.ObjectId,
    ref: target,
    index: true,
    default: null,
    ...options,
  };
}

/** Required `ObjectId` reference — used where a dangling record makes no sense. */
export function requiredRef(target: string, options: Partial<FieldDef> = {}): FieldDef {
  return {
    type: Schema.Types.ObjectId,
    ref: target,
    required: true,
    index: true,
    ...options,
  };
}

/**
 * Enum-constrained string backed by one of the `as const` value arrays in
 * `@shared/enums`. Validation therefore lives in exactly one place: adding a
 * status to the shared enum is enough for the database to accept it.
 */
export function enumField<T extends string>(
  values: readonly T[],
  options: { default?: T | null; required?: boolean; index?: boolean; unique?: boolean } = {}
): FieldDef {
  const field: FieldDef = {
    type: String,
    enum: values as unknown as string[],
  };
  if (options.default !== undefined) field.default = options.default;
  if (options.required) field.required = true;
  if (options.index) field.index = true;
  if (options.unique) field.unique = true;
  return field;
}

/* ─────────────────────── optimistic concurrency (§43) ───────────────────── */

/**
 * Adds a `version` counter that increments on every write, whatever path the
 * write takes — `save()`, `findOneAndUpdate()` or `updateOne()`.
 *
 * Two developers editing the same ticket is the normal case in a helpdesk, so
 * this is not decoration: services call `assertVersion(clientVersion, doc.version)`
 * before mutating and return `409 VERSION_CONFLICT` with the current value, which
 * the UI turns into "this ticket changed while you were typing".
 *
 * This counter is ours, not Mongoose's `__v`, which `BASE_SCHEMA_OPTIONS` disables
 * with `versionKey: false`. Do not call `doc.increment()` here to "help": that flag
 * arms Mongoose's own version machinery, which then reads
 * `schema.options.versionKey` — `false` — as a field path and throws
 * `Invalid path. Must be either string or array. Got "false"` from inside
 * `save()`. One counter, incremented in one place.
 */
export function versioned(schema: Schema): void {
  schema.add({
    version: { type: Number, default: 1, min: 1 },
  });

  schema.pre('save', function bumpOnSave(next) {
    // `isNew` documents start at 1; only real modifications advance the counter.
    if (!this.isNew && this.isModified()) {
      const current = this.get('version') as number | undefined;
      this.set('version', (current ?? 1) + 1);
    }
    next();
  });

  // Covers findOneAndUpdate / updateOne / updateMany so a service cannot forget.
  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany'],
    function bumpOnUpdate(this: mongoose.Query<unknown, unknown>, next) {
      const update = this.getUpdate();
      if (!update || Array.isArray(update)) return next();
      const typed = update as mongoose.UpdateQuery<Record<string, unknown>>;
      const alreadySet =
        typed.$set && Object.prototype.hasOwnProperty.call(typed.$set, 'version');
      const alreadyInc =
        typed.$inc && Object.prototype.hasOwnProperty.call(typed.$inc, 'version');
      if (!alreadySet && !alreadyInc) {
        typed.$inc = { ...(typed.$inc ?? {}), version: 1 };
        this.setUpdate(typed);
      }
      next();
    }
  );
}

/* ───────────────────────── human-friendly sequences ─────────────────────── */

/**
 * `TKT-000001`, `INC-000004`, `LAP-000012` — numbers people can read aloud on a
 * phone call. A dedicated counters collection with a single atomic
 * `findOneAndUpdate($inc)` is what makes them gap-free and race-free; deriving a
 * number from `count()` would hand two simultaneous requests the same value.
 */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, timestamps: false }
);

export const Counter: Model<CounterDoc> =
  (mongoose.models.Counter as Model<CounterDoc>) ??
  mongoose.model<CounterDoc>('Counter', counterSchema);

/** Reserve the next value of a named sequence. Atomic across concurrent calls. */
export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<CounterDoc>();
  return doc?.seq ?? 1;
}

/**
 * Reserve `count` consecutive values in one round trip — used by the seeder,
 * which would otherwise make 2,200 separate calls.
 */
export async function reserveSequence(
  name: string,
  count: number
): Promise<{ start: number; end: number }> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: count } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean<CounterDoc>();
  const end = doc?.seq ?? count;
  return { start: end - count + 1, end };
}

/** Reset a sequence — only used by `seed:reset`. */
export async function resetSequence(name: string, to = 0): Promise<void> {
  await Counter.findByIdAndUpdate(name, { $set: { seq: to } }, { upsert: true });
}

/* ──────────────────────────────── utilities ─────────────────────────────── */

/**
 * Register a model once. `tsx watch` re-evaluates modules on reload, and
 * `mongoose.model()` throws `OverwriteModelError` the second time; the seeder and
 * the test suite import models repeatedly for the same reason.
 *
 * The parameter is the unparameterised `Schema` rather than `Schema<T>` because
 * `new Schema<T>(...)` produces a type whose trailing generics Mongoose fills in
 * from its own inference (`Model<RawDocType, …>`), which is not assignable to the
 * `Schema<T>` written by hand. The cast is confined to this one line, and `T` is
 * still enforced at the boundary that matters: every caller passes its `*Doc`
 * interface, so `Model<T>` — the type services actually consume — stays exact.
 */
export function defineModel<T>(name: string, schema: Schema): Model<T> {
  return (
    (mongoose.models[name] as Model<T> | undefined) ??
    mongoose.model<T>(name, schema as unknown as Schema<T>)
  );
}

export type ObjectId = mongoose.Types.ObjectId;
export const toObjectId = (value: string): mongoose.Types.ObjectId =>
  new mongoose.Types.ObjectId(value);
export const isValidObjectId = (value: unknown): boolean =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
