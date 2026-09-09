/**
 * ServiceDesk Pro — auth service integration tests.
 *
 * These exercise the security properties the rest of the application leans on, so
 * they are deliberately about *behaviour an attacker would probe* rather than
 * coverage of every line:
 *
 *  - a client cannot choose its own role,
 *  - a wrong password and an unknown address are indistinguishable,
 *  - a refresh token works exactly once, and replaying one kills the family,
 *  - changing a password invalidates every token minted before it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Permission, Role, UserStatus } from '@shared/enums';
import { FixedClock } from '@/core/clock';
import { hashRefreshToken } from '@/core/auth/tokens';
import { Session, User } from '@/models';
import { clearDb, startDb, stopDb } from '@/test/db';
import {
  changePassword,
  currentUser,
  login,
  logout,
  refresh,
  register,
  type AuthContext,
} from '@/modules/auth/auth.service';
import type { ActorContext } from '@/core/actor';
import { resolvePermissions } from '@/core/authz/permissions';

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

const clock = new FixedClock('2026-01-05T09:00:00.000Z');

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    clock,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',
    requestId: 'test-request',
    ...overrides,
  };
}

/** An authenticated actor for the signed-in endpoints, built the way the middleware does. */
function actorFor(user: { id: string; name: string; email: string; role: Role }, sessionId: string): ActorContext {
  return {
    user: {
      ...user,
      status: UserStatus.ACTIVE,
      permissions: resolvePermissions(user.role),
      sessionId,
    },
    requestId: 'test-request',
    clock,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    automated: false,
  };
}

const CREDENTIALS = { name: 'Asha Menon', email: 'asha@example.com', password: 'Passw0rd!' };

/** Registers the bootstrap admin so later accounts are ordinary employees. */
async function seedFirstAdmin(): Promise<void> {
  await register({ name: 'Root Admin', email: 'root@example.com', password: 'Passw0rd!' }, ctx());
}

describe('register', () => {
  it('makes the very first account an admin so a fresh install is reachable', async () => {
    const result = await register(CREDENTIALS, ctx());
    expect(result.user.role).toBe(Role.ADMIN);
    expect(result.user.permissions).toContain(Permission.USER_MANAGE);
  });

  it('makes every later account an employee', async () => {
    await seedFirstAdmin();
    const result = await register(CREDENTIALS, ctx());
    expect(result.user.role).toBe(Role.EMPLOYEE);
    expect(result.user.permissions).not.toContain(Permission.USER_MANAGE);
  });

  it('ignores a role supplied by the client', async () => {
    await seedFirstAdmin();
    // The schema strips unknown keys, so this is what a hostile body degrades to.
    const result = await register({ ...CREDENTIALS, role: Role.ADMIN } as never, ctx());
    expect(result.user.role).toBe(Role.EMPLOYEE);
  });

  it('never returns the password hash', async () => {
    const result = await register(CREDENTIALS, ctx());
    expect(JSON.stringify(result.user)).not.toContain('$2');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('stores a bcrypt hash rather than the password', async () => {
    await register(CREDENTIALS, ctx());
    const stored = await User.findOne({ email: CREDENTIALS.email }).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain(CREDENTIALS.password);
  });

  it('rejects an address that is already registered', async () => {
    await register(CREDENTIALS, ctx());
    await expect(register(CREDENTIALS, ctx())).rejects.toMatchObject({ statusCode: 409 });
  });

  it('signs the new account in, opening exactly one session', async () => {
    const result = await register(CREDENTIALS, ctx());
    expect(result.accessToken.split('.')).toHaveLength(3);
    await expect(Session.countDocuments({ revokedAt: null })).resolves.toBe(1);
  });
});

describe('login', () => {
  it('returns tokens and the caller profile for correct credentials', async () => {
    await register(CREDENTIALS, ctx());
    const result = await login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx());
    expect(result.user.email).toBe(CREDENTIALS.email);
    expect(result.refreshToken.length).toBeGreaterThan(20);
    expect(new Date(result.accessTokenExpiresAt).getTime()).toBeGreaterThan(clock.nowMs());
  });

  it('gives the same error for a wrong password and an unknown address', async () => {
    await register(CREDENTIALS, ctx());
    const wrongPassword = await login({ email: CREDENTIALS.email, password: 'Wr0ngPass!' }, ctx())
      .then(() => null)
      .catch((error: Error) => error);
    const unknownEmail = await login({ email: 'nobody@example.com', password: 'Wr0ngPass!' }, ctx())
      .then(() => null)
      .catch((error: Error) => error);

    expect(wrongPassword?.message).toBe(unknownEmail?.message);
    expect(wrongPassword).toMatchObject({ statusCode: 401 });
    expect(unknownEmail).toMatchObject({ statusCode: 401 });
  });

  it('refuses a deactivated account, and only after the password verifies', async () => {
    await register(CREDENTIALS, ctx());
    await User.updateOne({ email: CREDENTIALS.email }, { $set: { status: UserStatus.INACTIVE } });

    // Right password on a disabled account: a distinct 403, so the UI can explain.
    await expect(
      login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx())
    ).rejects.toMatchObject({ statusCode: 403 });

    // Wrong password on the same account still looks exactly like any other
    // failed sign-in — the account's existence is not confirmed.
    await expect(
      login({ email: CREDENTIALS.email, password: 'Wr0ngPass!' }, ctx())
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('records the sign-in time and the device', async () => {
    await register(CREDENTIALS, ctx());
    await login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx());
    const stored = await User.findOne({ email: CREDENTIALS.email });
    expect(stored?.lastLoginAt?.toISOString()).toBe(clock.now().toISOString());
    const session = await Session.findOne({}).sort({ createdAt: -1 });
    expect(session?.deviceLabel).toBe('Chrome on Windows');
    expect(session?.ip).toBe('203.0.113.7');
  });
});

describe('refresh', () => {
  it('rotates the token, keeping the family and retiring the old row', async () => {
    const first = await register(CREDENTIALS, ctx());
    const second = await refresh({ refreshToken: first.refreshToken }, ctx());

    expect(second.refreshToken).not.toBe(first.refreshToken);

    const rows = await Session.find({}).select('+refreshTokenHash').sort({ createdAt: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.familyId).toBe(rows[1]?.familyId);
    expect(rows[0]?.revokedReason).toBe('rotated');
    expect(rows[0]?.replacedBySessionId?.toString()).toBe(rows[1]?._id.toString());
    expect(rows[1]?.refreshTokenHash).toBe(hashRefreshToken(second.refreshToken));
    expect(rows[1]?.revokedAt).toBeNull();
  });

  it('treats a replayed token as a leak and revokes the whole family', async () => {
    const first = await register(CREDENTIALS, ctx());
    const second = await refresh({ refreshToken: first.refreshToken }, ctx());

    // The thief (or the victim's stale tab) presents the consumed token again.
    await expect(refresh({ refreshToken: first.refreshToken }, ctx())).rejects.toMatchObject({
      statusCode: 401,
    });

    // Both parties are now locked out, including the currently valid token.
    await expect(Session.countDocuments({ revokedAt: null })).resolves.toBe(0);
    await expect(refresh({ refreshToken: second.refreshToken }, ctx())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects an unknown token without creating anything', async () => {
    await register(CREDENTIALS, ctx());
    await expect(refresh({ refreshToken: 'not-a-real-refresh-token' }, ctx())).rejects.toMatchObject(
      { statusCode: 401 }
    );
    await expect(Session.countDocuments({})).resolves.toBe(1);
  });

  it('rejects an expired session', async () => {
    const first = await register(CREDENTIALS, ctx());
    await Session.updateOne({}, { $set: { expiresAt: new Date(clock.nowMs() - 1000) } });
    await expect(refresh({ refreshToken: first.refreshToken }, ctx())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('stops working once the account is deactivated', async () => {
    const first = await register(CREDENTIALS, ctx());
    await User.updateOne({ email: CREDENTIALS.email }, { $set: { status: UserStatus.INACTIVE } });
    await expect(refresh({ refreshToken: first.refreshToken }, ctx())).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(Session.countDocuments({ revokedAt: null })).resolves.toBe(0);
  });
});

describe('logout and me', () => {
  it('revokes only the calling session and is idempotent', async () => {
    const first = await register(CREDENTIALS, ctx());
    const other = await login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx());

    const firstSession = await Session.findOne({
      refreshTokenHash: hashRefreshToken(first.refreshToken),
    }).select('+refreshTokenHash');
    const actor = actorFor(first.user, String(firstSession?._id));

    await logout(actor);
    await logout(actor); // no throw, no further effect

    await expect(Session.countDocuments({ revokedAt: null })).resolves.toBe(1);
    // The other device is untouched and can still refresh.
    await expect(refresh({ refreshToken: other.refreshToken }, ctx())).resolves.toBeTruthy();
  });

  it('returns the caller profile with permissions derived from the role', async () => {
    const registered = await register(CREDENTIALS, ctx());
    const profile = await currentUser(actorFor(registered.user, 'ignored'));
    expect(profile.email).toBe(CREDENTIALS.email);
    expect(profile.role).toBe(Role.ADMIN);
    expect(new Set(profile.permissions)).toEqual(resolvePermissions(Role.ADMIN));
    expect(profile.permissions).not.toHaveLength(0);
  });
});

describe('changePassword', () => {
  it('rejects a wrong current password with a field error, not a 401', async () => {
    const registered = await register(CREDENTIALS, ctx());
    const actor = actorFor(registered.user, 'ignored');
    await expect(
      changePassword(actor, { currentPassword: 'Wr0ngPass!', newPassword: 'BrandNew1' })
    ).rejects.toMatchObject({ statusCode: 400, fields: [{ path: 'currentPassword' }] });
  });

  it('replaces the password, revokes every session and hands back working tokens', async () => {
    const registered = await register(CREDENTIALS, ctx());
    await login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx());
    const actor = actorFor(registered.user, 'ignored');

    const result = await changePassword(actor, {
      currentPassword: CREDENTIALS.password,
      newPassword: 'BrandNew1',
    });

    // Exactly one live session: the one this call issued.
    await expect(Session.countDocuments({ revokedAt: null })).resolves.toBe(1);
    await expect(refresh({ refreshToken: result.refreshToken }, ctx())).resolves.toBeTruthy();

    // The old password is gone and the new one works.
    await expect(
      login({ email: CREDENTIALS.email, password: CREDENTIALS.password }, ctx())
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      login({ email: CREDENTIALS.email, password: 'BrandNew1' }, ctx())
    ).resolves.toBeTruthy();

    // `passwordChangedAt` is what makes previously issued access tokens fail.
    const stored = await User.findOne({ email: CREDENTIALS.email });
    expect(stored?.passwordChangedAt?.toISOString()).toBe(clock.now().toISOString());
  });
});
