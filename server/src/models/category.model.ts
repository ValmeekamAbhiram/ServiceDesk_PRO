/**
 * ServiceDesk Pro — ticket categories.
 *
 * A category is more than a dropdown label: `defaultPriority` means picking
 * "Network outage" proposes URGENT before anyone touches the priority field, and
 * the keyword classifier that suggests a category is therefore also suggesting a
 * sensible priority. The user can always override both.
 *
 * `ticketCount` is denormalised so the admin list and the dashboard's
 * "tickets by category" chart do not each need an aggregation over every ticket.
 */

import { Schema, Types } from 'mongoose';
import { Priority, PRIORITIES } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, versioned } from '@/models/helpers';

export interface CategoryDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string | null;
  /** Hex colour for the badge, so the UI holds no per-name palette. */
  color: string;
  defaultPriority: Priority;
  /**
   * Lower-case words that hint at this category. The offline ticket classifier
   * scores a title and description against these, which is what lets the
   * "suggest a category" feature work with no API key configured.
   */
  keywords: string[];
  /** Deactivated rather than deleted, so historical tickets keep their category. */
  active: boolean;
  sortOrder: number;
  ticketCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      // Uniqueness is declared once, as the schema-level index below.
      index: false,
    },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    color: { type: String, default: '#2563eb', trim: true, maxlength: 24 },
    defaultPriority: enumField(PRIORITIES, { required: true, default: Priority.MEDIUM }),
    keywords: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    ticketCount: { type: Number, default: 0, min: 0 },
  },
  BASE_SCHEMA_OPTIONS
);

versioned(categorySchema);

categorySchema.index({ slug: 1 }, { unique: true });
/** The picker: active categories in display order. */
categorySchema.index({ active: 1, sortOrder: 1, name: 1 });

export const Category = defineModel<CategoryDoc>('Category', categorySchema);
