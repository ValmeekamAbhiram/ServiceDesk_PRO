/**
 * ServiceDesk Pro — assets.
 *
 * Hardware the IT department is responsible for, and the reason a ticket can say
 * "this laptop" instead of "my laptop".
 *
 * ## The asset↔ticket link is the point
 *
 * A ticket may name an asset. That single reference is what turns a list of
 * hardware into something useful: the asset page shows every ticket ever raised
 * about that machine, so "this laptop has had four keyboard faults in six months"
 * is visible at a glance rather than being folklore held by one technician.
 * `ticketCount` and `openTicketCount` are denormalised for exactly that reason —
 * the counts appear on every row of the asset list, and an aggregation per row
 * would be the slowest query in the application.
 *
 * ## Warranty
 *
 * `warrantyExpiryDate` is stored; "days remaining" is computed per request from
 * the injected clock and never stored. A cached day count is wrong within
 * twenty-four hours of being written, which makes it the textbook example of a
 * value that must stay derived.
 *
 * ## Serial numbers are unique when present
 *
 * A partial unique index, not a plain one: two assets may both have no serial
 * number (a monitor, a cable tray), but two assets must never claim the same one.
 * A plain unique index would treat every `null` as a duplicate of the last, so
 * the second asset without a serial number would be rejected.
 */

import { Schema, Types } from 'mongoose';
import { ASSET_STATUSES, ASSET_TYPES, AssetStatus, AssetType } from '@shared/enums';
import {
  BASE_SCHEMA_OPTIONS,
  defineModel,
  enumField,
  ref,
  versioned,
} from '@/models/helpers';

/** Sequence name for `nextSequence()`. */
export const ASSET_SEQUENCE = 'asset';
export const ASSET_TAG_PREFIX = 'AST';

export interface AssetDoc {
  _id: Types.ObjectId;
  /** `AST-000001` — the sticker on the machine. */
  tag: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  assignedToId: Types.ObjectId | null;
  purchaseDate: Date | null;
  purchaseCost: number | null;
  warrantyExpiryDate: Date | null;
  notes: string | null;
  /** Denormalised — see the header. */
  ticketCount: number;
  openTicketCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<AssetDoc>(
  {
    tag: { type: String, required: true, uppercase: true, maxlength: 20, index: false },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: enumField(ASSET_TYPES, { required: true, default: AssetType.OTHER }),
    status: enumField(ASSET_STATUSES, { required: true, default: AssetStatus.IN_STOCK }),
    serialNumber: { type: String, default: null, trim: true, maxlength: 120, index: false },
    manufacturer: { type: String, default: null, trim: true, maxlength: 80 },
    model: { type: String, default: null, trim: true, maxlength: 120 },
    location: { type: String, default: null, trim: true, maxlength: 120 },
    assignedToId: ref('User', { index: false }),
    purchaseDate: { type: Date, default: null },
    purchaseCost: { type: Number, default: null, min: 0 },
    warrantyExpiryDate: { type: Date, default: null },
    notes: { type: String, default: null, maxlength: 2000 },
    ticketCount: { type: Number, default: 0, min: 0 },
    openTicketCount: { type: Number, default: 0, min: 0 },
  },
  BASE_SCHEMA_OPTIONS
);

versioned(assetSchema);

assetSchema.index({ tag: 1 }, { unique: true });

/** Unique only where a serial number exists — see the header. */
assetSchema.index(
  { serialNumber: 1 },
  {
    unique: true,
    name: 'asset_serial_unique',
    partialFilterExpression: { serialNumber: { $type: 'string' } },
  }
);

/** The asset list, filtered by type and status. */
assetSchema.index({ status: 1, type: 1, name: 1 });
/** "What hardware does this person have?" — shown on the user page. */
assetSchema.index({ assignedToId: 1, status: 1 });
/** The warranty radar: everything expiring soonest first. Sparse. */
assetSchema.index({ warrantyExpiryDate: 1 }, { sparse: true });

/** Asset search by tag, name, serial or model. */
assetSchema.index(
  { tag: 'text', name: 'text', serialNumber: 'text', model: 'text' },
  { name: 'asset_search', weights: { tag: 20, serialNumber: 10, name: 8, model: 4 } }
);

export const Asset = defineModel<AssetDoc>('Asset', assetSchema);
