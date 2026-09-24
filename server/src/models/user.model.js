/**
 * ServiceDesk Pro — users.
 *
 * ## Passwords
 *
 * `passwordHash` carries `select: false`, so it is absent from every query
 * unless a caller explicitly asks for it. That is the difference between "we
 * remember not to leak the hash" and "the hash is not there to leak" — the
 * authentication service is the only code that opts in, and a careless
 * `res.json(user)` anywhere else cannot expose it.
 *
 * `passwordChangedAt` exists so changing a password invalidates tokens issued
 * before the change. Without it, "change my password" reassures a user whose
 * account was compromised while the attacker's existing token keeps working.
 *
 * ## Deactivated, not deleted
 *
 * A user who leaves becomes `INACTIVE`. Deleting the row would orphan every
 * ticket they raised and every comment they wrote, and a ticket history with
 * "unknown user" in it is worth much less than one that still names people.
 *
 * ## Counters
 *
 * `openTicketCount` and `assignedTicketCount` are denormalised. They are
 * maintained in the same operation that writes the ticket, so the technician
 * list renders without a `$lookup` per row — the query that would otherwise be
 * the slowest thing on the busiest page.
 */
import { Schema } from 'mongoose';
import { Role, ROLES, UserStatus, USER_STATUSES } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, versioned } from '@/models/helpers';
const userSchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 200,
        // Uniqueness is declared once, as the schema-level index below.
        index: false,
    },
    passwordHash: { type: String, required: true, select: false },
    role: enumField(ROLES, { required: true, default: Role.EMPLOYEE }),
    status: enumField(USER_STATUSES, { required: true, default: UserStatus.ACTIVE }),
    jobTitle: { type: String, default: null, trim: true, maxlength: 120 },
    phone: { type: String, default: null, trim: true, maxlength: 40 },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    openTicketCount: { type: Number, default: 0, min: 0 },
    assignedTicketCount: { type: Number, default: 0, min: 0 },
}, BASE_SCHEMA_OPTIONS);
versioned(userSchema);
/** Login is a lookup by email, so this index is on the hottest auth path. */
userSchema.index({ email: 1 }, { unique: true });
/** The technician picker: active staff of a given role. */
userSchema.index({ role: 1, status: 1 });
/** Admin user search. */
userSchema.index({ name: 'text', email: 'text' }, { name: 'user_search' });
export const User = defineModel('User', userSchema);
