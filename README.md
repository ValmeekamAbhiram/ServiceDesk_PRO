# ServiceDesk Pro

An IT helpdesk for a small internal support team: staff raise tickets, technicians
work them against an SLA clock, and an admin keeps the categories, people and
knowledge base in order.

Built as a MERN application — MongoDB, Express, React, Node — in TypeScript
end to end, with a `shared/` package holding the enums and DTOs both sides
compile against, so a renamed status breaks the build rather than the UI.

## What it does

| | |
|---|---|
| **Tickets** | Raise with attachments and an optional linked asset; search, filter and sort a paginated queue; six statuses behind a transition table; four priorities; assign; public replies and internal notes; a status-history timeline; reopen. Concurrent edits are caught by a version check, not last-write-wins. |
| **SLA** | One policy with a response and resolution target per priority. Deadlines are counted in *business* hours, so a Friday-evening ticket is not already late on Monday morning. Every ticket shows `ON_TRACK` / `AT_RISK` / `BREACHED` / `MET` and a live countdown. |
| **Assets** | Laptops, monitors, phones and the rest: CRUD, type and status, assignment to a person, a warranty radar for what expires soon, and a link between an asset and the tickets raised against it. |
| **Knowledge base** | Draft and published articles, and a weighted full-text search where a phrase in the title counts for ten times the same phrase buried in a two-thousand-word body. View counts. |
| **AI suggestion** | On a new ticket, one endpoint suggests a category, a priority and related articles, with a confidence and a reason. It suggests — it never applies anything, publishes anything or changes a permission. With no API key configured it runs an offline keyword classifier, so the feature works out of the box. |
| **Dashboard** | KPIs, tickets by status / priority / category, a 14-day volume series, per-technician load, and what is about to breach. |
| **Notifications** | Persisted, delivered live over Socket.IO, with an unread badge. In-app only — there is no email in this build. |
| **Admin** | Users and roles, categories, the SLA policy (business hours, at-risk threshold, per-priority budgets), an append-only audit trail with a diff per entry, and system settings. Plus a **Time Machine** that fast-forwards the clock so SLA breaches can be demonstrated without waiting four hours — off in production, always. |

Three roles: **ADMIN**, **TECHNICIAN**, **EMPLOYEE**. Authorization is enforced in
the service layer, never in the UI — an employee's queries are narrowed to their
own tickets by a Mongo filter, and an id outside their scope answers 404 rather
than admitting the record exists.

## Requirements

- **Node 20 or newer** (`.nvmrc` pins 20; `nvm use` picks it up).
- **MongoDB** — optional. Without one, the server starts an in-process MongoDB
  and seeds it, so a fresh clone runs with nothing installed. That database lives
  in memory and is gone when you stop the server.

## Running it

```bash
npm run setup     # installs both workspaces and writes .env from .env.example
npm run seed      # only if you have a real MongoDB — see below
npm run dev       # API on :5000, web app on :5173
```

Open **http://localhost:5173** and sign in.

`npm run setup` never overwrites an existing `.env`. The defaults it copies are
development values and the app refuses to start in production while they are in
place.

**With no MongoDB installed**, skip `npm run seed` — `npm run dev` is enough. The
server falls back to an in-process MongoDB, seeds it with a smaller demo dataset
on every boot, and prints the logins. Nothing you do in the app survives a
restart, which is the trade for not installing a database.

**With MongoDB running**, `npm run seed` fills it once with the full dataset:
14 users, 7 categories, 40 assets, 6 articles and 120 tickets across three months
of history, with comments, status timelines, notifications and SLA outcomes that
follow from each ticket's age. It takes about six seconds. It refuses to touch a
database that already has data — use `npm run seed:reset` to replace what is
there, or `npm run seed:minimal` for accounts and categories with no history.

## Demo accounts

All three share one password, `SEED_PASSWORD` in `.env` — **`Passw0rd!`** unless
you changed it.

| Role | Email | Sees |
|---|---|---|
| ADMIN | `admin@servicedesk.local` | Everything, plus users, categories and the SLA policy |
| TECHNICIAN | `tech@servicedesk.local` | The whole queue, and their own assignments |
| EMPLOYEE | `employee@servicedesk.local` | Only the tickets they raised |

> These are **development credentials**, documented so the app can be demonstrated.
> They are seeded data, not production accounts. Change `SEED_PASSWORD`, `JWT_SECRET`
> and `JWT_REFRESH_SECRET` before this application is exposed to anyone.

## Scripts

Run from the repository root; each delegates to the workspace that owns it.

| | |
|---|---|
| `npm run dev` | API and web app together, both watching |
| `npm run dev:server` / `npm run dev:client` | One side only |
| `npm test` | Both test suites |
| `npm run test:server` / `npm run test:client` | One suite |
| `npm run typecheck` | `tsc --noEmit` over both workspaces |
| `npm run build` | Typecheck the server, build the client bundle |
| `npm start` | Production server (`NODE_ENV=production`) |
| `npm run seed` / `seed:reset` / `seed:minimal` | Demo data — see above |

The server tests start their own throwaway MongoDB, so they neither need nor
touch your local one. The first run downloads a MongoDB binary and is slow; later
runs are not.

## Layout

```
shared/src/     Enums and DTOs — the contract both sides compile against
server/src/     Express API: models, modules (route/controller/service), core/ (pure)
client/src/     React app: pages, components, hooks, api client
docs/           Engineering conventions
```

The API is mounted under `/api`: `auth`, `tickets`, `attachments`, `categories`,
`assets`, `articles`, `users`, `dashboard`, `notifications`, `suggestions`.
Socket.IO listens on the `/rt` namespace.

`docs/ENGINEERING_SPEC.md` is the reference for how this codebase is written —
the response envelope, the authorization model, the enum and import rules, and
the data conventions around versioning and denormalised counters.
