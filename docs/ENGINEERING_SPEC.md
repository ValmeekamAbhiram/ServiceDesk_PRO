# ServiceDesk Pro — Engineering Conventions

Internal reference. Every module in this repository follows these rules; when in
doubt, match the nearest existing file rather than introducing a new pattern.

## 1. Repository layout

```
servicedesk-pro/
├── shared/src/           # Contract shared by server + client. Bottom of the
│                         # dependency graph — imports nothing from either side.
│   ├── enums.ts          # `as const` objects + derived union types
│   ├── types.ts          # Wire DTOs (ids are strings, dates are ISO strings)
│   ├── labels.ts         # Human labels + tones for every enum value
│   ├── socket.ts         # Socket.IO event names + room helpers
│   └── utils.ts          # Pure helpers usable on both sides
├── server/src/
│   ├── config/           # env, db, logger
│   ├── core/             # Pure domain logic. No Express, no Mongoose.
│   │   ├── auth/         # Password hashing, token signing and verification
│   │   ├── authz/        # Role → permission resolution
│   │   ├── clock/        # Clock, RealClock, FixedClock
│   │   └── sla/          # Business-hours SLA engine (+ its unit tests)
│   ├── models/           # Mongoose schemas, one file per collection
│   ├── middleware/       # authenticate, authorize, validate, error, ...
│   ├── modules/<name>/   # <name>.routes.ts | .controller.ts | .service.ts
│   │                     # | .schema.ts | .mapper.ts  (+ .test.ts)
│   │                     # articles assets attachments auth categories
│   │                     # dashboard notifications settings sla suggestions
│   │                     # tickets users
│   ├── realtime/         # Socket.IO server, auth, rooms, emit helpers
│   ├── seed/             # Deterministic demo data + its CLI
│   ├── test/             # In-memory Mongo harness shared by the suites
│   ├── utils/            # respond(), errors, small shared helpers
│   ├── app.ts            # Express app factory (no listen)
│   └── index.ts          # Bootstrap: env → db → app → http → sockets
└── client/src/
    ├── api/              # axios instance + one file per resource
    ├── components/       # ui/ (primitives), domain/, layout/
    ├── hooks/            # Cross-feature hooks
    ├── pages/            # Route components
    ├── routes/           # Router, guards
    ├── stores/           # Zustand stores (auth, ui)
    ├── lib/              # cn(), formatters, query client, socket client
    └── styles/index.css  # Design tokens + component classes
```

There is no `services/`, `jobs/`, `ai/`, `core/scoring/` or `core/similarity/`
directory, and no `features/` on the client. An earlier draft of this document
listed them; the scope was cut to the nine features in the README and those
layers went with it. Do not create one to hold a single file — put cross-cutting
infrastructure in `utils/` and domain logic in `core/`.

## 2. Imports

- **Always extensionless**: `import { x } from './foo'` — never `'./foo.js'`.
  Both packages use `moduleResolution: "bundler"`; the server runs on `tsx`.
- **`@shared/*`** → `shared/src/*`, aliased in `server/tsconfig.json`,
  `server/vitest.config.ts`, `client/tsconfig.json` and `client/vite.config.ts`.
  Import from a leaf (`@shared/enums`) rather than the barrel where practical.
- **`@/*`** → the local package's `src/*`.
- Enums are runtime values; DTOs are types:
  ```ts
  import { TicketStatus, Priority } from '@shared/enums';
  import type { TicketDto } from '@shared/types';
  ```

## 3. Enums

`shared/src/enums.ts` is the single source of truth. TS `enum` is never used —
every enum is an `as const` object plus a derived union type plus a values array:

```ts
export const SlaState = { ON_TRACK: 'ON_TRACK', /* ... */ } as const;
export type SlaState = (typeof SlaState)[keyof typeof SlaState];
export const SLA_STATES = Object.values(SlaState) as SlaState[];
```

Never inline a string literal where an enum member exists. Never add a status,
role, permission or error code anywhere except `shared/src/enums.ts`.

## 4. HTTP response envelope

Success (single resource or arbitrary payload):

```json
{ "success": true, "data": { ... }, "requestId": "b3f1..." }
```

Paginated list — the page is a *value* under `data`, not a sibling of it, so a
list response is the same shape as any other and one `ApiSuccess<T>` type covers
both:

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "meta": { "page": 1, "limit": 25, "total": 431, "totalPages": 18,
              "hasNext": true }
  },
  "requestId": "b3f1..."
}
```

There is no `hasPrev`: `page > 1` is the same information and one fewer field to
keep consistent. Categories are the exception to the envelope — the list is
short, unpaginated, and sits directly under `data` as a plain array.

Failure — always this shape, never a raw stack trace:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable summary.",
    "fields": [{ "path": "priority", "message": "Invalid value" }]
  },
  "requestId": "b3f1..."
}
```

`requestId` sits beside `error`, exactly where it sits beside `data` on a
success, so a client logs it the same way whichever branch it took. `fields` is
the full list of validation problems, not just the first. Two error codes add one
key each to `error`: `VERSION_CONFLICT` sends `currentVersion` so the UI can
offer a reconciliation view, and `RATE_LIMITED` sends `retryAfterSeconds`.

`code` is always an `ErrorCode` from `shared/src/enums.ts`. Controllers never
build envelopes by hand — they use `ok()`, `created()`, `paginated()` and
`noContent()` from `server/src/utils/respond.ts`, and throw a subclass of
`AppError` from `server/src/utils/errors.ts` for failures (`NotFoundError`,
`ForbiddenError`, `ConflictError`, `ValidationError`, `VersionConflictError`,
`InvalidTransitionError`, and the rest — each one carries its own status and
`ErrorCode`, so a route never picks either). `middleware/error.ts` is the only
place that formats a failure response, the only place that logs a stack trace,
and the only place that decides whether an error's message is safe to show a
user: an unrecognised throw becomes a generic `INTERNAL_ERROR` message and the
real one goes to the log.

## 5. Layering

```
routes  →  middleware  →  controller  →  service  →  model
                                     ↘  core/ (pure)
```

- **routes**: path + middleware wiring only. No logic.
- **middleware**: `requestId()`, `requestLog()`, `authenticate()` /
  `optionalAuth()`, `requireRole()`, `requirePermission()` /
  `requireAllPermissions()`, `requireResourceOwnership()`, `requireDemoMode()`,
  `validate(schema)`, the in-process rate limiters, `notFoundHandler()` and
  `errorHandler()`. Rate limiting is a sliding window held in a `Map` — there is
  no Redis in this stack, and one process does not need one.
- **controller**: parse the validated request, call one service method, respond.
  Controllers never touch Mongoose models directly.
- **service**: all business rules, authorization scoping, notification dispatch
  and socket emission. Services receive an `ActorContext`
  (`{ user, requestId, clock, ip, userAgent, automated }`) as their *last*
  argument — never an Express `Request`. Time comes from `actor.clock`, never
  `Date.now()`, which is what lets the SLA engine and the seeder be tested at a
  fixed instant.
- **core/**: pure functions. May not import Mongoose, Express, or config. Fully
  unit-testable with plain objects.

## 6. Authorization

**Never trust anything the client says about identity, role, or scope.** The
access token's payload is verified server-side and re-hydrated from the database
on every request; `req.user` is the only source of truth.

Three layers, all enforced in the service/middleware, never in the UI:

1. `requireRole(...roles)` — coarse gate on the route.
2. `requirePermission(...perms)` — fine-grained `Permission` strings resolved
   from `ROLE_PERMISSIONS`, and from nothing else. There are no per-user grants
   or denials, so no user record can hold a permission its role does not
   describe, and demoting a user takes effect on their next request rather than
   when their token expires.
3. **A scope filter inside the service** — every read and every write starts
   from `ticketScopeFilter(actor)`, which returns a Mongo filter: `{}` for a
   holder of `TICKET_READ_ALL`, `{ requesterId: <caller> }` for everyone else.
   In practice that means ADMIN and TECHNICIAN see the whole queue and an
   EMPLOYEE sees only tickets they raised. Single-document reads go through
   `loadScoped()`, which applies the same filter, so an id the caller may not
   see answers `NOT_FOUND` rather than `FORBIDDEN` — we do not leak the
   existence of records outside the caller's scope.

There are exactly three roles — `ADMIN`, `TECHNICIAN`, `EMPLOYEE` — and no
departments. A technician's queue is the whole queue.

Caller-supplied filters are combined with the scope clause under `$and`, never
by assignment: `filter.requesterId = query.requesterId` would overwrite the
scope clause an employee is confined by and turn a filter into privilege
escalation. `ticketScopeFilter` is exported for the dashboard, which aggregates
over the same collection and must count exactly the rows this service would
return; a second copy of the rule there would be free to drift, and the first
symptom would be an at-risk panel listing tickets its reader cannot open.

The client mirrors permissions only to hide UI affordances. Hiding a button is
never the security boundary.

## 7. Data conventions

- **Optimistic concurrency.** Mutable documents call `versioned(schema)`, which
  replaces Mongoose's `__v` with a plain `version: number` the API can expose and
  a client can send back. A write that carries a version passes it to
  `assertVersion(sent, current, 'ticket')`, which throws
  `VersionConflictError` — a 409 whose body carries `currentVersion`. Two rules
  follow from `versionKey: false`: `doc.increment()` throws, so never call it, and
  a *newly created* document is version 1, not 0.
- **Denormalised counters move by `$inc`, never by recount.** `Category.ticketCount`
  and `Asset.ticketCount` are lifetime totals; `User.openTicketCount`,
  `User.assignedTicketCount` and `Asset.openTicketCount` track the live queue.
  Recomputing one from a `countDocuments` would race with the write that
  triggered it. When a ticket moves between two owners of a counter, resolve the
  new owner *before* decrementing the old one, so a rejected write leaves both
  totals untouched.
- **Singletons upsert themselves.** `SlaPolicy` (key `default`) and
  `SystemSettings` (key `global`) are read through accessors that
  `findOneAndUpdate(..., { upsert: true, setDefaultsOnInsert: true })`, so a
  fresh database needs no bootstrap step. Both cache in-process; a write must
  call `invalidateSlaPolicyCache()` / `invalidateSystemSettingsCache()`.
- **`timestamps: true` is not under our control.** Mongoose stamps `createdAt`
  and `updatedAt` from the real system clock, after middleware, so no hook can
  backdate them and SLA maths must never start from `createdAt`. The seeder is
  the one place that rewrites them, and it does so through the raw driver.
- **Global Mongoose settings live in `applyMongooseDefaults()`** (`config/db.ts`),
  which `src/test/db.ts` also calls. A setting made only in `db.ts` would apply
  in production and not under test — that exact gap once hid a `sanitizeFilter`
  flag that broke every `$in` query while the suite stayed green.
- **Don't add a field nothing reads.** A model property or DTO key with no
  consumer is indistinguishable from a bug in waiting. Wire it up or drop it.

## 8. Tests

`vitest`, colocated as `*.test.ts` beside the file under test. `npm test` from
the repository root runs both workspaces; `npm run test:server` runs one.

Service and route tests talk to a real MongoDB — a throwaway one.
`src/test/db.ts` starts a single `mongodb-memory-server` instance for the whole
run and never touches `MONGO_URI`, so the suite exercises real queries, real
indexes and real `$inc` without depending on (or damaging) a developer's local
database. `vitest.config.ts` pins the specs to one fork so that instance can be
shared instead of paying the startup cost per file. The first run downloads a
MongoDB binary and is therefore slow; later runs are not.

`clearDb()` runs between tests and *deletes documents* rather than dropping
collections, so the indexes built on first connect survive — a suite asserting
that a duplicate email is rejected must not pass or fail depending on whether it
ran first. It also clears the singleton caches, because a cached policy
outliving the row it mirrors surfaces as an unrelated test breaking three files
later.

Anything with a deadline in it takes a `FixedClock` (`core/clock`), which
`advanceMinutes()` moves by hand. No test sleeps, and none depends on the wall
clock — an SLA breach is asserted by moving the clock past the target, not by
waiting for it.
