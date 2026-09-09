#!/usr/bin/env node
/**
 * Runs after `npm install` via `npm run setup`.
 * Creates the local .env from .env.example when it is missing so that a fresh
 * clone boots with zero manual configuration, and prints the next steps.
 *
 * It never overwrites an existing .env, and never prints secret values.
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const exists = async (p) => {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (await exists(envPath)) {
  console.log('  .env already present — left untouched.');
} else if (await exists(examplePath)) {
  await copyFile(examplePath, envPath);
  console.log('  Created .env from .env.example (development defaults).');
} else {
  console.warn('  .env.example not found; skipping .env creation.');
}

await mkdir(path.join(root, 'server', 'uploads'), { recursive: true });

console.log('');
console.log('  ServiceDesk Pro is ready.');
console.log('');
console.log('    npm run seed     Populate MongoDB with demo data');
console.log('    npm run dev      Start the API (:5000) and web app (:5173)');
console.log('');
console.log('  No MongoDB installed? Just run npm run dev. An in-memory MongoDB is');
console.log('  started automatically and seeded on every boot, so you get the same');
console.log('  demo accounts — they just do not survive a restart.');
console.log('');
