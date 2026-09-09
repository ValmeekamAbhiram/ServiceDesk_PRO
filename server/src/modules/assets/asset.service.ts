/**
 * ServiceDesk Pro — assets.
 *
 * ## Reading is scoped, and the scope is a filter
 *
 * `ASSET_READ` is held by every role, including EMPLOYEE, because somebody needs to
 * see the laptop they were issued. It does **not** mean "read the inventory": an
 * employee who could list every asset would be reading serial numbers, locations and
 * purchase costs for the whole company. So the scope narrows by role — staff see
 * everything, an employee sees only what is assigned to them — and it narrows by
 * *filter*, `scopeFilter()`, applied in one place and never re-derived per endpoint.
 *
 * A hidden asset answers **404, not 403**, the same as a hidden ticket. 403 confirms
 * the row exists, which is the fact being withheld.
 *
 * ## Writing is admin-only
 *
 * `ASSET_MANAGE` is in the ADMIN set and no other. A technician can read the whole
 * inventory — they need it to diagnose a ticket — but the inventory itself is
 * maintained by an administrator. That comes straight from `ROLE_PERMISSIONS` rather
 * than being decided here.
 *
 * ## No delete, and one invariant
 *
 * Assets are RETIRED, never removed: tickets reference them, and deleting the row
 * would leave that history pointing at nothing (the same reasoning as categories).
 * Retiring also clears `assignedToId`, because "retired, and still issued to Ada" is
 * a state nobody can act on. Conversely a retired asset cannot be handed to anyone
 * until it is un-retired.
 *
 * ## Warranty days are always derived
 *
 * `warrantyDaysRemaining` is computed per request from `actor.clock`, never stored —
 * a cached day count is wrong within twenty-four hours. Using the injected clock
 * rather than `Date.now()` is what lets the demo clock move time and have the
 * warranty radar move with it.
 */

import type { FilterQuery, SortOrder } from 'mongoose';
import type { AssetDto, Paginated, UserRefDto } from '@shared/types';
import { AssetStatus, AuditAction, AuditEntity, UserStatus } from '@shared/enums';
import { logger } from '@/config/logger';
import { isStaff, type ActorContext } from '@/core/actor';
import { Asset, User, nextSequence, toObjectId, type AssetDoc } from '@/models';
import { ASSET_SEQUENCE, ASSET_TAG_PREFIX } from '@/models/asset.model';
import { diff, record } from '@/modules/audit/audit.service';
import { toUserRefDtoOrNull } from '@/modules/users/user.mapper';
import { populatedDoc } from '@/utils/populate';
import { ConflictError, DuplicateError, ValidationError, assertFound, assertVersion } from '@/utils/errors';
import { resolvePaging, toPaginated } from '@/utils/respond';
import type { AssetInputBody, ListAssetsInput, UpdateAssetInput } from '@/modules/assets/asset.schema';

const log = logger.child({ module: 'asset.service' });

const MS_PER_DAY = 86_400_000;

export function formatAssetTag(sequence: number): string {
  return `${ASSET_TAG_PREFIX}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Whole days until the warranty lapses, negative once it has. `Math.ceil` so an
 * expiry later today reads as 1 day rather than 0 — "0 days left" should mean the
 * cover is gone, not that it runs out this afternoon.
 */
function warrantyDaysRemaining(expiry: Date | null, now: Date): number | null {
  if (!expiry) return null;
  return Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY);
}

type AssignedTo = AssetDoc['assignedToId'] | { _id: unknown; name?: string } | null;

export function toAssetDto(asset: AssetDoc, now: Date): AssetDto {
  return {
    id: String(asset._id),
    tag: asset.tag,
    name: asset.name,
    type: asset.type,
    status: asset.status,
    serialNumber: asset.serialNumber,
    manufacturer: asset.manufacturer,
    model: asset.model,
    location: asset.location,
    assignedTo: assignedToRef(asset.assignedToId as AssignedTo),
    purchaseDate: asset.purchaseDate?.toISOString() ?? null,
    purchaseCost: asset.purchaseCost,
    warrantyExpiryDate: asset.warrantyExpiryDate?.toISOString() ?? null,
    warrantyDaysRemaining: warrantyDaysRemaining(asset.warrantyExpiryDate, now),
    notes: asset.notes,
    ticketCount: asset.ticketCount,
    openTicketCount: asset.openTicketCount,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    version: asset.version,
  };
}

/**
 * `assignedToId` is an ObjectId when unpopulated and a user document when populated;
 * only the populated form can produce a name, and an unpopulated id would otherwise
 * render as a `UserRefDto` with a blank label.
 */
function assignedToRef(value: AssignedTo): UserRefDto | null {
  return toUserRefDtoOrNull(populatedDoc(value, 'name') as never);
}

/* ──────────────────────────────── reading ───────────────────────────────── */

/**
 * The one place the read rule lives. Staff get `{}`; an employee gets a filter
 * pinning `assignedToId` to themselves, which is what makes every other query in this
 * module safe by construction rather than by remembering.
 */
function scopeFilter(actor: ActorContext): FilterQuery<AssetDoc> {
  if (isStaff(actor)) return {};
  return { assignedToId: toObjectId(actor.user.id) };
}

const ASSET_POPULATE = { path: 'assignedToId', select: 'name email role status' } as const;

const SORT_FIELDS: Record<ListAssetsInput['sortBy'], string> = {
  name: 'name',
  tag: 'tag',
  createdAt: 'createdAt',
  warrantyExpiryDate: 'warrantyExpiryDate',
};

/**
 * Caller filters are combined under `$and` with the scope clause, never merged into
 * one object: `filter.assignedToId = query.assignedToId` would overwrite the clause
 * that restricts an employee to their own hardware, which turns a filter into a
 * privilege escalation. Under `$and` a caller clause can only narrow. This is the
 * same rule, for the same reason, as `buildListFilter` in the ticket service.
 */
function buildListFilter(query: ListAssetsInput, actor: ActorContext): FilterQuery<AssetDoc> {
  const clauses: FilterQuery<AssetDoc>[] = [scopeFilter(actor)];

  if (query.type) clauses.push({ type: { $in: query.type } });
  if (query.status) clauses.push({ status: { $in: query.status } });
  if (query.assignedToId) clauses.push({ assignedToId: toObjectId(query.assignedToId) });

  if (query.warrantyWithinDays !== undefined) {
    const horizon = new Date(actor.clock.now().getTime() + query.warrantyWithinDays * MS_PER_DAY);
    /* `$ne: null` as well as `$lte`, because a null expiry is not "expiring soon" —
     * in Mongo's ordering `null` sorts below every date and would match the bound. */
    clauses.push({ warrantyExpiryDate: { $ne: null, $lte: horizon } });
  }

  return { $and: clauses };
}

export async function list(
  query: ListAssetsInput,
  actor: ActorContext
): Promise<Paginated<AssetDto>> {
  const { page, limit, skip } = resolvePaging(query);
  const filter = buildListFilter(query, actor);
  if (query.q) Object.assign(filter, { $text: { $search: query.q } });

  const direction: SortOrder = query.sortOrder === 'asc' ? 1 : -1;
  /* `_id` breaks ties, so two monitors with the same name cannot swap places between
   * page 1 and page 2 — which would show one twice and the other never. */
  const sort: Record<string, SortOrder | { $meta: 'textScore' }> = query.q
    ? { score: { $meta: 'textScore' }, _id: -1 }
    : { [SORT_FIELDS[query.sortBy]]: direction, _id: direction };

  const cursor = Asset.find(filter)
    .populate({ ...ASSET_POPULATE })
    .sort(sort as never)
    .skip(skip)
    .limit(limit);
  if (query.q) cursor.select({ score: { $meta: 'textScore' } });

  const [rows, total] = await Promise.all([cursor.exec(), Asset.countDocuments(filter)]);
  const now = actor.clock.now();
  return toPaginated(
    rows.map((row) => toAssetDto(row as unknown as AssetDoc, now)),
    page,
    limit,
    total
  );
}

/**
 * Loads one asset within the caller's scope. An asset that exists but is assigned to
 * somebody else is reported as missing — see the header.
 */
async function loadScoped(id: string, actor: ActorContext) {
  const found = await Asset.findOne({
    $and: [{ _id: toObjectId(id) }, scopeFilter(actor)],
  }).populate({ ...ASSET_POPULATE });
  return assertFound(found, 'Asset');
}

export async function getById(id: string, actor: ActorContext): Promise<AssetDto> {
  const asset = await loadScoped(id, actor);
  return toAssetDto(asset as unknown as AssetDoc, actor.clock.now());
}

/* ──────────────────────────────── writing ───────────────────────────────── */

/**
 * `''` is not a serial number, and it must not be stored as one. The unique index is
 * partial on `{ serialNumber: { $type: 'string' } }`, so an empty string *is* indexed
 * and the second asset saved with a blank serial box would collide with the first.
 *
 * The request schema already does this, and this repeats it deliberately: the seed
 * script and any future automation call the service directly, without passing through
 * `validate()`, and "the caller normalised it" is a poor thing for a uniqueness
 * guarantee to rest on.
 */
function normalizeSerial(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A serial number is unique where it exists. The index enforces that too, but
 * checking here turns a driver `E11000` into a 409 naming the offending field, which
 * is what a form can actually display.
 */
async function assertSerialFree(serial: string | null, excludeId?: unknown): Promise<void> {
  if (!serial) return;
  const clash = await Asset.exists({
    serialNumber: serial,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw new DuplicateError('An asset with that serial number already exists.', [
      { path: 'serialNumber', message: 'Already recorded against another asset.' },
    ]);
  }
}

/**
 * Resolves the holder of an asset. An unknown or deactivated user is a 422 on the
 * field rather than a silent `null`: quietly dropping the assignment would leave the
 * admin believing the laptop had been handed over.
 */
async function resolveHolder(userId: string): Promise<unknown> {
  const holder = await User.findOne({ _id: toObjectId(userId), status: UserStatus.ACTIVE })
    .select('_id')
    .lean();
  if (!holder) {
    throw new ValidationError('That person cannot hold an asset.', [
      { path: 'assignedToId', message: 'No active user with that id.' },
    ]);
  }
  return holder._id;
}

export async function create(input: AssetInputBody, actor: ActorContext): Promise<AssetDto> {
  const serial = normalizeSerial(input.serialNumber);
  await assertSerialFree(serial);

  const status = input.status ?? AssetStatus.IN_STOCK;
  const assignedToId = input.assignedToId ? await resolveHolder(input.assignedToId) : null;
  if (assignedToId && status === AssetStatus.RETIRED) {
    throw new ConflictError('A retired asset cannot be issued to anyone.');
  }

  const tag = formatAssetTag(await nextSequence(ASSET_SEQUENCE));
  const asset = await Asset.create({
    tag,
    name: input.name,
    type: input.type,
    status,
    serialNumber: serial,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    location: input.location ?? null,
    assignedToId,
    purchaseDate: input.purchaseDate ?? null,
    purchaseCost: input.purchaseCost ?? null,
    warrantyExpiryDate: input.warrantyExpiryDate ?? null,
    notes: input.notes ?? null,
  });

  log.info({ requestId: actor.requestId, assetId: String(asset._id), tag }, 'asset created');
  await record(
    {
      action: AuditAction.ASSET_CREATED,
      entityType: AuditEntity.ASSET,
      entityId: String(asset._id),
      entityLabel: tag,
      summary: `Added ${tag} — ${asset.name}`,
    },
    actor
  );

  return toAssetDto(await asset.populate({ ...ASSET_POPULATE }), actor.clock.now());
}

/**
 * The fields worth a line in the audit trail. `notes` is free text nobody reports on
 * and `purchaseCost` is on the list because a changed price is exactly the kind of
 * edit somebody asks about six months later.
 *
 * `serialNumber`, `assignedToId` and `status` matter most: those three are what an
 * asset dispute is usually about.
 */
const AUDITED_ASSET_FIELDS = [
  'name',
  'type',
  'status',
  'serialNumber',
  'assignedToId',
  'location',
  'purchaseCost',
  'warrantyExpiryDate',
] as const;

function auditSnapshot(asset: AssetDoc): Record<string, unknown> {
  return {
    name: asset.name,
    type: asset.type,
    status: asset.status,
    serialNumber: asset.serialNumber,
    assignedToId: asset.assignedToId,
    location: asset.location,
    purchaseCost: asset.purchaseCost,
    warrantyExpiryDate: asset.warrantyExpiryDate,
  };
}

/**
 * An admin edit. `version` must match, so the slower of two people editing the same
 * laptop is told rather than silently overwriting the other.
 *
 * The two status rules are applied here, after the incoming fields are merged, so
 * they hold whichever order the caller sends them in — retiring and reassigning in
 * one request cannot slip between the checks.
 */
export async function update(
  id: string,
  input: UpdateAssetInput,
  actor: ActorContext
): Promise<AssetDto> {
  const found = await Asset.findById(toObjectId(id));
  const asset = assertFound(found, 'Asset');
  assertVersion(input.version, asset.version, 'Asset');
  const before = auditSnapshot(asset);

  if (input.serialNumber !== undefined) {
    const serial = normalizeSerial(input.serialNumber);
    await assertSerialFree(serial, asset._id);
    asset.serialNumber = serial;
  }
  if (input.assignedToId !== undefined) {
    asset.assignedToId = (
      input.assignedToId ? await resolveHolder(input.assignedToId) : null
    ) as AssetDoc['assignedToId'];
  }

  if (input.name !== undefined) asset.name = input.name;
  if (input.type !== undefined) asset.type = input.type;
  if (input.status !== undefined) asset.status = input.status;
  if (input.manufacturer !== undefined) asset.manufacturer = input.manufacturer;
  /* `set()` rather than `asset.model = ...`: Mongoose gives every document a
   * `model()` method, and this schema has a path of the same name, so the assignment
   * does not typecheck against the hydrated document. The path API sidesteps the
   * collision without renaming a field the DTO contract already publishes. */
  if (input.model !== undefined) asset.set('model', input.model);
  if (input.location !== undefined) asset.location = input.location;
  if (input.purchaseDate !== undefined) asset.purchaseDate = input.purchaseDate;
  if (input.purchaseCost !== undefined) asset.purchaseCost = input.purchaseCost;
  if (input.warrantyExpiryDate !== undefined) asset.warrantyExpiryDate = input.warrantyExpiryDate;
  if (input.notes !== undefined) asset.notes = input.notes;

  /* Retiring releases the holder. Anything else assigned to a retired asset is
   * refused, so the two rules together make "RETIRED with a holder" unreachable. */
  if (asset.status === AssetStatus.RETIRED) {
    if (input.assignedToId) {
      throw new ConflictError('A retired asset cannot be issued to anyone.');
    }
    asset.assignedToId = null;
  }

  await asset.save();
  log.info(
    { requestId: actor.requestId, assetId: id, status: asset.status },
    'asset updated'
  );
  await record(
    {
      action: AuditAction.ASSET_UPDATED,
      entityType: AuditEntity.ASSET,
      entityId: id,
      entityLabel: asset.tag,
      summary: `Edited ${asset.tag}`,
      changes: diff(before, auditSnapshot(asset), AUDITED_ASSET_FIELDS),
    },
    actor
  );

  return toAssetDto(await asset.populate({ ...ASSET_POPULATE }), actor.clock.now());
}
