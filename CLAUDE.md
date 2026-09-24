## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Conventions

Stack is **MERN + JavaScript (ES Modules + JSX)** — no Redis, Elasticsearch, vector DB, message
queue or mandatory cloud service. Search is Mongo text indexes, rate limiting is
in-process, background work is `setInterval`, uploads go to local disk via multer.

- **Enums** are frozen objects, in `shared/src/enums.js`.
  Bridge to Zod with `z.nativeEnum(X)`.
- **Imports are extensionless**, `"type": "module"`, so no `require()`.
  Path aliases `@/` and `@shared/` are configured via `jsconfig.json`, Vite, and `tsconfig.json`.
- **tsx only applies tsconfig `paths` to files matched by `include`.** A scratch script
  at the server root or in `/tmp` cannot resolve `@/…` or even `mongoose`. Put
  throwaway repros in `server/src/`.
- **Services take an `ActorContext`** (`@/core/actor`), never an Express `Request`.
- **Read authorization is a Mongo filter.** Combine caller filters with the scope
  clause under `$and`, never by assignment — `filter.requesterId = query.requesterId`
  overwrites the scope clause and becomes privilege escalation. A row the caller may
  not see answers **404, not 403**.
- **Time comes from `actor.clock`**, never `Date.now()`. Mongoose `timestamps: true`
  writes `createdAt` from the real system clock, so SLA maths must never start from it.
- **Global Mongoose settings live in `applyMongooseDefaults()`** in `src/config/db.ts`,
  and `src/test/db.ts` calls it too. It opens its own connection, so a setting made
  only in `db.ts` would apply in production and not in tests — that gap once hid a
  `sanitizeFilter` flag that broke every `$in` query while the suite stayed green.
- `versioned(schema)` makes a fresh document **version 1**, and `versionKey: false`
  means `doc.increment()` throws. Never call it.
- `respond.paginated()` puts `{ items, meta }` directly under `data`. Categories are a
  plain array under `data`.
- Denormalised counters are adjusted with `$inc`, never recomputed and rewritten.
- Don't add a model field or DTO property nothing reads. Either wire it up or drop it.
