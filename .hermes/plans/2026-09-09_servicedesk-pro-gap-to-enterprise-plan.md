# ServiceDesk Pro — Gap to Enterprise Spec Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close the gap between the existing solid MERN foundation and the enterprise ITSM spec (major incidents, asset intelligence, AI flywheel, SLA pause, analytics depth, polish) without breaking what works.

**Architecture:** Extend existing `modules/<name>/` + `core/` (pure) + `shared/` (contract) conventions. No new top-level layers (`services/`, `ai/`, `jobs/` banned per ENGINEERING_SPEC). Every new domain follows routes/controller/service/schema/mapper + tests. Time from `actor.clock`, authz via service-layer scope filters (404 not 403), enums only in `shared/src/enums.ts`.

**Tech Stack:** React 19 + Vite + Tailwind + React Query + Zustand, Express 4 + Mongoose 8 + Socket.IO 4, Zod, Vitest + Supertest, mongodb-memory-server for tests, tsx. No Redis/ES/vector DB — search stays Mongo text indexes; semantic similarity stays keyword/TF-IDF in-process unless AI key set.

---

## 1. Current context (verified 2026-09-09, `E:/ServiceDesk PRO`)

### What EXISTS and works
- **Foundation:** JWT access+refresh, RBAC (ADMIN/TECHNICIAN/EMPLOYEE), 3-role scope filter (`ticketScopeFilter`), users/categories CRUD, audit log (immutable, diffs), settings + demo/Time Machine routes, request-id/rate-limit/helmet/cors, consistent `{success,data,requestId}` envelope.
- **Tickets (6 statuses, not 10):** OPEN/IN_PROGRESS/ON_HOLD/RESOLVED/CLOSED/REOPENED + transition table, priorities LOW/MED/HIGH/URGENT, assignment, comments (public/internal), attachments (multer local disk), status-history timeline, version optimistic concurrency (`versioned()` helper), paginated search/filter/sort.
- **SLA engine (pure, tested):** business-hours calc (Mon–Fri 09–18 default, timezone-aware), response+resolution budgets per priority, deadline via `addBusinessMinutes`, verdict via `businessMinutesBetween`, at-risk threshold, monitor sweep (`sla-monitor.ts`), countdown DTO (`slaResponseRemainingMs`). Injectable Clock (RealClock/FixedClock/DemoClock via `getClock()`), Time Machine demo routes. **Explicitly NO pause** (engine.ts docblock says ON_HOLD still burns).
- **Assets (basic CRUD):** type/status, assignment, asset↔ticket link, list/detail/edit pages. No health/TCO/warranty/licenses/QR.
- **Knowledge (basic):** draft/published articles, weighted full-text search, views. No REVIEW/APPROVED workflow states, no versioning, no votes, no embeddings.
- **AI suggestions (suggest-only):** keyword classifier + optional LLM (`suggestion.llm.ts`, Anthropic SDK), category/priority + 3 related articles, `source: classifier|llm`. No triage (urgency/impact/team/skills), no RAG citations, no similar-tickets, no deflection tracking, no article generation.
- **Realtime:** Socket.IO `/rt` namespace, auth handshake, queue room + user rooms + ticket watch rooms (scope-checked), ticket/comment/status events, notifications persisted + unread badge. No presence/collision.
- **Dashboard:** one-request DTO (KPIs, by status/priority/category, 14-day volume, tech load, breach list), volume + breakdown charts (Recharts), tech load table. No MTTR/FCR/CSAT/deflection, no heatmap, no backlog-aging interaction, no staffing recs.
- **Client shell:** AppShell sidebar+topbar, Cmd+K palette (tickets/assets/articles/users, no incidents), shortcuts hook + overlay, light theme only, no Framer Motion, skeleton/empty/error states present on main pages.
- **Tests:** ~24 suites (SLA engine, auth, tickets, assets, articles, dashboard, notifications, audit, SLA policy, suggestions, socket). No incident/asset-health/RAG/idempotency tests.
- **Seed:** ~14 users, 7 categories, 40 assets, 6 articles, 120 tickets. Spec wants 150 users/300 assets/2000 tickets/80 articles/12 incidents/6 months.
- **Git:** `master`, zero commits, everything staged (`A`/`AM`) — commit before any work.

### What is MISSING (spec vs repo)
1. **Major incidents:** zero files (no model/routes/service/pages, no parent/child, bulk resolve, outage banner, duplicate detection).
2. **Ticket lifecycle gaps:** no ASSIGNED/WAITING_FOR_REQUESTER/WAITING_FOR_INTERNAL/ESCALATED; no urgency/impact/team/skills fields; no worklogs; no related/parent/child links; no idempotency keys; no satisfaction/CSAT model.
3. **SLA pause/resume:** engine deliberately burns ON_HOLD; spec demands WAITING_FOR_REQUESTER pauses with business-time accounting + multiple pauses + priority-change reprice (reprice exists, pause does not).
4. **Asset intelligence:** no health score, TCO, warranty radar, licenses, QR, history timeline beyond ticket link.
5. **AI flywheel:** no embeddings/vector field, no RAG grounded replies with sources, no similar-tickets endpoint, no deflection events, no draft-reply, no generate-article (draft-only) flow.
6. **Analytics:** no heatmap, backlog-aging buckets, SLA-by-priority trend, MTTR/FCR/CSAT/deflection KPIs, staffing recommendations.
7. **Realtime depth:** no presence (`viewing`/`editing` events), no collision banner.
8. **Admin:** no departments, holidays, business-hours editor (policy exists, holidays do not), no SLA-policies plural (single policy doc).
9. **Docs/API:** no ARCHITECTURE.md/SLA_DESIGN.md/AI_DESIGN.md/API.md, no Swagger/OpenAPI.
10. **UX:** no dark mode (#07090D system), no Framer Motion micro-interactions, employee portal not differentiated, QR flow absent.

---

## 2. Ground rules (from CLAUDE.md + ENGINEERING_SPEC — non-negotiable)
- Enums only in `shared/src/enums.ts` as `as const` + union + values array; Zod via `z.nativeEnum`.
- Extensionless imports, `@/*` local, `@shared/*` leaf imports.
- Services take `ActorContext`, never `req`; reads combine caller filter + scope under `$and` (never overwrite); out-of-scope → 404.
- Time from `actor.clock`; never `Date.now()`; never start SLA maths from `createdAt` (Mongoose real-clock write).
- `versioned(schema)` docs start at version 1; never call `doc.increment()` (versionKey:false).
- `respond.paginated()` `{items,meta}` under `data`; counters via `$inc`.
- No field/DTO nothing reads — wire it or drop it.

---

## 3. Phased plan (ordered; each phase independently shippable + committable)

### Phase 0 — Baseline lock (30 min, do first)
- **Files:** none (git only) + `E:/ServiceDesk PRO/logs/` untouched.
- Steps: `git add -A && git commit -m "chore: baseline servicedesk-pro foundation"`; `npm run typecheck`; `npm run test:server` (expect pass; first run downloads Mongo binary, slow); record failures as Day-0 bugs.
- Verify: `git log --oneline -1` exists; typecheck green.

### Phase 1 — Ticket lifecycle completion + idempotency + worklogs + CSAT
- **Why first:** everything (incidents, SLA pause, AI) keys off ticket states.
- **Shared (`shared/src/enums.ts`, `types.ts`):** add `ASSIGNED, WAITING_FOR_REQUESTER, WAITING_FOR_INTERNAL, ESCALATED` to `TicketStatus`; extend `TICKET_TRANSITIONS`; add `SatisfactionRating` type; add `IdempotencyKey` header constant doc in types (`TicketCreateRequest.idempotencyKey?`).
- **Server:** `server/src/models/ticket.model.ts` (+urgency/impact/team/skills/parentId/relatedIds/incidentId/idempotencyKey unique sparse), new `ticket-worklog.model.ts`, `satisfaction.model.ts`; extend `ticket.service.ts` (transitions, WAITING_* sets pause — see Phase 2, idempotency check on create: `findOne({idempotencyKey})` return existing); `ticket.schema.ts` (Zod); `ticket.mapper.ts` (new fields to DTO).
- **Client:** `TicketDetail.tsx` (worklog tab, related links, CSAT stars form for requester on RESOLVED), `TicketList.tsx` (new status filters).
- **Tests:** extend `ticket.service.test.ts` (transitions, idempotent double-POST, CSAT immutable by technician).
- Verify: `npm run test:server -- ticket`, `npm run typecheck`.

### Phase 2 — SLA pause/resume + holidays + priority-change (signature #1)
- **Engine (`server/src/core/sla/engine.ts`, `business-hours.ts`):** add `PauseInterval {from,to}[]` to `SlaTargetSnapshot`; `businessMinutesBetween` minus paused business minutes; `pauseTarget/resumeTarget/repriceTarget` pure fns; priority change → recompute remaining budget, keep consumed.
- **Models:** ticket SLA subdocs gain `pauses[]`, `holidays[]` ref; new `holiday.model.ts` + `business-hours` policy extension (or settings doc — prefer extend `sla-policy.model.ts`, do NOT create `core/scoring/`).
- **Monitor (`sla-monitor.ts`):** WAITING_FOR_REQUESTER/WAITING_FOR_INTERNAL excluded from breach sweep; resume re-arms.
- **Time Machine:** existing demo routes already swap clock — add `+15m/+30m/+1h/+4h/+1d/Reset` UI if missing (`AdminSettings.tsx` or new `TimeMachine.tsx` component, demo-only, forced off when `NODE_ENV=production`).
- **Tests:** new cases in `engine.test.ts`: weekend, Friday-17:30→Monday, holiday, single pause, multiple pauses, priority change mid-flight, breach exactness.
- Verify: demo script — create URGENT 4h ticket → +3h AT_RISK → +1h BREACHED, dashboard/audit/notification update with no refresh.

### Phase 3 — Realtime presence + collision (signature #2)
- **Shared (`shared/src/socket.ts`):** add `ticket:viewing`, `ticket:editing`, `ticket:presence` events + payload types.
- **Server (`server/src/realtime/socket.ts`, `emit.ts`):** track `watching` set already exists — broadcast presence per ticket room on join/leave/disconnect; throttle `editing` (heartbeat 5s, expiry 15s).
- **Client (`lib/realtime.ts`, `hooks/useRealtime.ts`, `TicketDetail.tsx`):** presence avatars ("Rahul is viewing"), amber banner on remote edit start.
- **Tests:** extend `socket.test.ts` (two sockets same ticket → both see presence; disconnect clears).
- Verify: Browser A + B manual check.

### Phase 4 — Asset intelligence (signature #5)
- **Models:** extend `asset.model.ts` (purchaseDate, purchaseCost, repairCost, warrantyUntil, specs, qrSlug), new `asset-history.model.ts` (append-only: ASSIGNED/REPAIR/RETIRED…), `software-license.model.ts` (purchased/assigned/expiry).
- **Core (deterministic, `server/src/core/asset/health.ts` new pure file):** `healthScore({ageYears, ticketCount, repairCost, downtimeDays, warrantyExpired, replacementCost}) → {score 0–100, band, reasons[]}`; `tco({purchase, repairs, labor})`. AI may EXPLAIN only.
- **Service/routes:** warranty radar query (`warrantyUntil <= +30/60/90d`), history on asset mutation, license compliance warnings (assigned>purchased).
- **QR:** `qrcode` npm pkg, `GET /api/assets/:id/qr` PNG/SVG; asset tag URL `/a/:slug` → mobile-friendly `AssetDetail` with Report-Problem → `TicketNew?assetId=`.
- **Client:** `AssetDetail.tsx` (health ring, TCO block, history timeline, QR card), `AssetList.tsx` (radar filter chips).
- **Tests:** `asset-health.test.ts` (pure), `asset.routes.test.ts` (radar, licenses).
- Verify: LAP-1029 style profile renders with deterministic numbers.

### Phase 5 — Major incidents + parent/child + duplicate detection + banner (signature #3)
- **Shared:** `IncidentSeverity (SEV-1..4)`, `IncidentStatus (INVESTIGATING/IDENTIFIED/MONITORING/RESOLVED/CLOSED)`.
- **Server:** `major-incident.model.ts` (number INC-000000 seq, commander, severity, impactedDepts, affectedTickets virtual/count, timeline[]), `incident.service.ts` (link/unlink/bulk-resolve with templated child resolution + audit per child), `incident.routes.ts` (`/api/incidents`), duplicate-detection pure fn (`core/incidents/similarity.ts`: TF-IDF/cosine over title+dept+category, in-process, threshold 0.8, never auto-merge).
- **Client:** `Incidents.tsx` list, `IncidentDetail.tsx` (32-ticket tree, link/unlink, bulk resolve), `OutageBanner.tsx` in AppShell (dept-scoped, live via socket), TicketNew duplicate warning ("Possible INC-004, 92%, 23 tickets — Link | Create incident | Ignore").
- **Tests:** linking, bulk resolve writes child resolutions + audit, similarity precision on seeded VPN fixtures.
- Verify: create 5 VPN tickets → suggestion appears → create INC → link → bulk resolve → banner clears.

### Phase 6 — AI flywheel: triage + RAG + similar + deflection + draft article (signature #4)
- **Keep offline-first:** classifier fallback always; LLM (`suggestion.llm.ts` pattern) only when `AI_API_KEY` set; never auto-apply/publish.
- **Triage:** extend `suggestion.service.ts` response (urgency/impact/suggestedTeam/suggestedSkills/probableCause/confidence) — LLM prompt change + classifier heuristic addition; human override in TicketNew UI.
- **RAG (no vector DB):** reuse Mongo `$text` weighted search as retriever; new `POST /api/ai/search` returns `{answer, sources:[{articleId,title,snippet}]}` where answer is extractive/template + LLM-grounded (prompt includes ONLY retrieved chunks; "not in sources" refusal). Add `KnowledgeEmbedding` as keyword-signature cache field on article (NOT a new infra service).
- **Similar tickets:** `GET /api/tickets/:id/similar` — TF-IDF over resolved tickets same category, top 3 with % + resolution + tech + duration.
- **Deflection:** new `deflection-event.model.ts` (`{sessionId, queryHash, articleIds shown, deflected:bool, ticketId?}`); TicketNew "Did this solve it? YES/NO"; dashboard deflection KPI (`deflected/total`).
- **Generate article:** `POST /api/ai/generate-article {ticketId}` → DRAFT article (title/problem/symptoms/cause/resolution/prevention/tags, `sourceTickets:[id]`), needs ARTICLE_PUBLISH approval; never auto-publish.
- **Tests:** classifier tests, RAG refusal when no sources, similar-ticket ranking, deflection math.
- Verify: resolve novel VPN ticket → Generate Article → approve → new employee types same symptom → article retrieved → YES → deflection ↑ without ticket.

### Phase 7 — Analytics command center
- **Dashboard service (`dashboard.service.ts`):** add MTTR (resolvedAt−createdAt business minutes median), FCR (% resolved without reopen), CSAT avg, deflection rate, backlog-aging buckets (<1d/1–3/3–7/7–14/14+d with ticket ids for click-filter), heatmap (dow×hour matrix), SLA-by-priority met/at-risk/breached, staffing recommendation string (peak Monday 10–12 rule: max cell + adjacent).
- **Client (`Dashboard.tsx`, `DashboardCharts.tsx`):** KPI cards with trend (reuse `KpiDto`), volume chart 7/30/90/180d range switch, heatmap grid, aging bars clickable → `/tickets?agedBucket=`.
- **Tests:** `dashboard.service.test.ts` additions (buckets, heatmap, staffing string deterministic).
- Verify: seeded 120 tickets produce non-empty heatmap + aging.

### Phase 8 — Shell polish: dark mode + motion + employee portal + docs + seed scale
- **Theme:** CSS vars (`styles/index.css`) for `#07090D/#0D1117/#11161D`, `ThemeToggle` in Topbar, `ui.store` persisted; semantic colors (blue/green/amber/red/purple-AI/cyan-live only).
- **Motion:** add `framer-motion` (client only), wrap queue insert/notification/SLA-flip/modal/sidebar in <150ms purposeful transitions.
- **Employee portal:** simplified home (`EmployeeHome.tsx`: "What can we help you with?" + AI suggestions + My Tickets + Announcements from published articles/outage banner).
- **Shortcuts:** extend `useKeyboardShortcuts.ts` (N/A/R/E/K/C) + help overlay (exists — extend).
- **Docs:** `README.md` (update counts), new `ARCHITECTURE.md`, `SLA_DESIGN.md`, `AI_DESIGN.md`, `API.md` (or Swagger: `swagger-ui-express + swagger-jsdoc`, `GET /api/docs` — needs `swagger` dep; keep docs-first, Swagger optional).
- **Seed scale:** extend `seed/data.ts+seed.ts` toward 150 users/300 assets/2000 tickets/80 articles/12 incidents + VPN/WiFi/printer fixtures (behind `SEED_*` env; keep default 120 for speed, `--full` flag for 2000).
- **Tests:** keep `npm test` both suites green; add client critical tests (palette, ticket create idempotency).
- Verify: Lighthouse-ish manual pass (no blank screens: skeleton/empty/error each route), mobile QR flow, `npm run build`.

---

## 4. Files likely to change (largest surface)
- `shared/src/enums.ts`, `shared/src/types.ts`, `shared/src/socket.ts`
- `server/src/models/*` (+3 new: worklog, satisfaction/deflection, major-incident, holiday, asset-history, license)
- `server/src/core/sla/*`, new `server/src/core/asset/health.ts`, new `server/src/core/incidents/similarity.ts`
- `server/src/modules/{tickets,incidents,sla,dashboard,assets,articles,suggestions,settings}/*`
- `server/src/realtime/*`
- `client/src/pages/*` (+Incidents, EmployeeHome), `components/{domain,layout,palette}`, `hooks/`, `lib/`, `styles/index.css`
- `docs/*`, `.env.example` (only keys, never secrets), `server/src/seed/*`

## 5. Tests / validation per phase
- `npm run typecheck` (both workspaces) after every phase.
- `npm run test:server` / `test:client` per phase scope (vitest); SLA pure tests must stay HTTP/Mongo-free.
- Manual demo script (the 10-min story): employee VPN → AI suggest → ticket → live tech queue → triage+similar+KB+asset+countdown → Time Machine +3h/+1h breach → escalation → 5× VPN → INC-004 link 32 → bulk resolve → generate article → approve → re-query deflects → asset health/TCO.

## 6. Risks, tradeoffs, open questions
- **Scope is 6–10× current seed/code size.** Recommend ship Phases 0–3 first (correctness), then 4–5, then 6–8. Do NOT start polish before incidents+pause land.
- **No vector DB per repo rules:** semantic = TF-IDF/keyword + Mongo text. True embeddings need a new service — explicitly deferred; note in AI_DESIGN.md.
- **Single SLA policy vs "SLA Policies" plural:** keep single-policy doc (admin-editable) unless multi-policy explicitly requested — avoids migration.
- **Departments:** spec wants departments/teams; repo deliberately cut them. Incidents need `impactedDepts: string[]` free-text first; full Department model only if requested (adds user/dept scoping complexity).
- **SMTP/email:** spec mentions email events; README says in-app only, no email. Stay in-app + audit; add SMTP only as Phase 9 if asked.
- **Framer/Swagger/QR deps** are new attack surface — pin versions, keep server `qrcode` only.
- **Seed 2000 tickets** slows `npm run seed` (~minutes) — gate behind flag.
- **Open questions for you:** (1) New statuses — adopt all 10 or keep 6 + ESCALATED only? (2) Departments as real model or strings? (3) Email in or out? (4) Dark mode default? (5) Full 2000-ticket seed or keep 120 default?

---

## 7. Suggested execution order for subagents
0 → 1 → 2 → 3 → 5 → 4 → 6 → 7 → 8. (Incidents before assets because duplicate-detection reuses ticket text pipeline that triage also needs.)
Each task: failing test → minimal code → pass → `git commit`. Never mix phases in one commit.
