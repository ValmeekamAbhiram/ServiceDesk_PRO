/**
 * ServiceDesk Pro — shared contract barrel.
 *
 * Import from `@shared/index` (or a specific module) on both sides of the app:
 *
 *   import { TicketStatus, type TicketDto } from '@shared/index';
 *
 * The alias is configured in `server/tsconfig.json`, `client/tsconfig.json` and
 * `client/vite.config.ts`. Nothing in `shared/` may import from `server/` or
 * `client/` — it is the bottom of the dependency graph.
 */
export * from './enums';
export * from './types';
export * from './labels';
export * from './socket';
export * from './utils';
