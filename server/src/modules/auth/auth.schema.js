/**
 * ServiceDesk Pro — auth request schemas.
 *
 * Two things these schemas do that are load-bearing rather than cosmetic:
 *
 *  - **`role` is absent.** Zod strips unknown keys, so `POST /auth/register` with
 *    `{ name, email, password, role: 'ADMIN' }` reaches the service as three fields.
 *    The client cannot nominate its own role because the shape it is parsed into has
 *    nowhere to put one — which is a stronger guarantee than a service remembering
 *    to ignore it.
 *  - **Passwords are capped at 72 characters.** bcrypt hashes only the first 72
 *    *bytes* of its input and silently ignores the rest, so a 100-character password
 *    would authenticate against its own first 72 characters. Rejecting the input is
 *    honest; truncating it quietly is not.
 */
import { z } from 'zod';
/** Lower-cased here so the unique index and every lookup agree on one form. */
const emailField = z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(254)
    .email('Enter a valid email address.');
const nameField = z.string().trim().min(2, 'Please give your full name.').max(120);
/**
 * Long enough to resist a list attack, with one letter and one digit required so
 * "password" and "12345678" are both out. Deliberately not a maze of character
 * classes: length is what matters, and rules that force `P@ssw0rd!` mostly produce
 * `P@ssw0rd!`.
 */
const passwordField = z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(72, 'Use at most 72 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.');
export const registerSchema = {
    body: z.object({
        name: nameField,
        email: emailField,
        password: passwordField,
    }),
};
/**
 * Login does not re-apply the password policy. An account created before a policy
 * change must still be able to sign in — and rejecting a login for a weak password
 * would tell an attacker that the password was at least the right shape.
 */
export const loginSchema = {
    body: z.object({
        email: emailField,
        password: z.string().min(1, 'Enter your password.').max(200),
    }),
};
export const refreshSchema = {
    body: z.object({
        refreshToken: z.string().min(20, 'Missing refresh token.').max(200),
    }),
};
export const changePasswordSchema = {
    body: z
        .object({
        currentPassword: z.string().min(1, 'Enter your current password.').max(200),
        newPassword: passwordField,
    })
        .refine((value) => value.currentPassword !== value.newPassword, {
        message: 'The new password must be different from the current one.',
        path: ['newPassword'],
    }),
};
