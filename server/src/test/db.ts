/**
 * ServiceDesk Pro — integration-test database harness.
 *
 * Boots one in-process MongoDB for the whole run and hands the suites a clean
 * database between tests. `vitest.config.ts` pins integration specs to a single
 * fork (`singleFork` + `sequence.concurrent: false`) precisely so this instance can
 * be shared instead of paying the multi-second startup per file.
 *
 * `clearDb()` deletes documents rather than dropping collections, so the indexes
 * created on first connect — including the unique index on `User.email` and the
 * TTL index on `Session.expiresAt` — survive into the next test. A suite asserting
 * that a duplicate email is rejected would otherwise pass or fail depending on
 * whether it happened to run first.
 *
 * `clearDb()` also drops the process-level caches that hold documents, because a
 * cached document outliving the row it mirrors is the kind of failure that shows up
 * as an unrelated test breaking three files later. Registering the invalidation here
 * rather than in each suite's `afterEach` means a new suite cannot forget it.
 *
 * `startDb()` calls `applyMongooseDefaults()` because this harness opens its own
 * connection and never imports `src/config/db.ts`, so any global Mongoose setting
 * made there would otherwise apply in production and not in tests. That gap once
 * hid a `sanitizeFilter` setting that broke every `$in` filter in the application
 * while the whole suite stayed green.
 *
 * `registerTestConnection()` closes the second half of the same gap: `dbHealth()` reads
 * a module-level record of what was connected to, which only the real `connectDb()`
 * writes, so the health endpoint would report `kind: null` here and a real kind in a
 * deployment.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { applyMongooseDefaults, registerTestConnection } from '@/config/db';
import { invalidateSlaPolicyCache } from '@/modules/sla/sla-policy.service';
import { invalidateSystemSettingsCache } from '@/modules/settings/settings.service';

let server: MongoMemoryServer | null = null;

export async function startDb(): Promise<void> {
  if (server) return;
  applyMongooseDefaults();
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: 'servicedesk_test' });
  registerTestConnection(server.getUri());
  // Import for the side effect of registering every schema, then build indexes
  // once so uniqueness is actually enforced in tests.
  await import('@/models');
  await mongoose.connection.syncIndexes({ continueOnError: true });
}

export async function clearDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  invalidateSlaPolicyCache();
  invalidateSystemSettingsCache();
}

export async function stopDb(): Promise<void> {
  registerTestConnection(null);
  await mongoose.disconnect();
  await server?.stop();
  server = null;
}
