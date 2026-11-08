# Help Pay Bills — host-ready public edition

People post bills they need help with, donors pay the bill company directly
through the biller's own guest payment link, and the poster confirms each
payment and marks the bill paid. **The app itself never touches money.**

This is a standalone, host-ready copy of the app. It runs on any host that
can run [Bun](https://bun.sh) with a SQLite file — no Muse/Hatch runtime,
no proprietary SDK. It starts empty: no bills, no pledges, no user data.

It is public-ready: it has email + password accounts (passwords stored as
argon2id hashes), bills that belong to the account that posted them, user
reports with an admin moderation panel, and rate limits on sign-in, sign-up,
and bill posting. See "Accounts and moderation" below.

## What changed from the Muse version

The original app ran on the Muse hosted runtime and imported the proprietary
`@hatch/space-sdk`. Every SDK use has been replaced with plain equivalents:

| Before (Muse SDK) | Now (standalone) |
| --- | --- |
| `defineAction` + `ctx` | Plain handler functions in `server/src/actions.ts`, dispatched by `server/src/server.ts` |
| `ctx.db` | Direct Drizzle SQLite connection (`server/src/db.ts`, `bun:sqlite`) |
| `ctx.blobs.put/delete/getUrl` | Local files under the uploads directory, served at `/uploads/*` |
| `ctx.invalidateQueries()` | Normal TanStack Query refetching (the client already did this) |
| `createActionClient` | Plain `fetch` POSTs of `{action, args}` to `./actions` (`client/src/api.ts`) |
| `spaceQueryClient` | The app's own `QueryClient` (`client/src/main.tsx`) |
| `SafeAreaTopScrim` | Removed (it was Muse-shell chrome; a plain host has no notch scrim) |
| `file:/opt/hatch/...` SDK dependency | Removed — `bun install` works anywhere |

Everything else is unchanged: the same bills, pledges, confirmations,
proof-photo upload (JPG/PNG/WebP/GIF, 6 MB cap), duplicate guards
(`formKey` / `pledgeKey`), payment caps, status math, and the same
futuristic dark look (deep space black, HUD grid, electric cyan) with the
same congregation photograph in the hero.

## Accounts and moderation

- **Sign up / sign in.** Email + password, no third-party login service.
  Passwords are hashed with argon2id (`Bun.password`) and never stored in
  plain text. Sign-in sets an HttpOnly cookie session that lasts 30 days.
  There is no email verification and no password reset yet — see "What
  still needs doing".
- **Ownership.** A bill belongs to the account that posted it. Only the
  poster (or an admin) can edit it, confirm payments on it, or delete it.
  Payments are recorded by signed-in accounts and tied to them. Anyone can
  browse the board without signing in; posting a bill or recording a
  payment needs an account.
- **Reports.** Any signed-in user can report a bill (Spam, Scam / fake
  bill, Wrong amount, Abusive content, Other) with an optional note — one
  report per person per bill.
- **Admin panel.** Admins get a Moderation view (top-right button) listing
  open reports with the bill, reporter, and reason, plus all accounts.
  From there an admin can hide a bill (it disappears for everyone but
  admins) or show it again, remove a bill, mark a report resolved, and
  block or unblock an account. Blocking signs the account out everywhere
  immediately; a blocked account cannot sign back in.
- **Admin setup.** Set `ADMIN_EMAIL` to the admin's email address before
  the first deploy (see Configuration below). Any account with that email
  is an admin — at signup, and again on every server start, so the admin
  can be promoted even if the account already exists. If `ADMIN_EMAIL` is
  not set, the very first account to sign up becomes the admin. Either
  way, make sure the admin account is the one you control.
- **Rate limits** (in-memory, per window; a server restart clears them):
  sign-in 10 attempts / 15 min per IP plus 5 failed attempts / 15 min per
  email; sign-up 10 / hour per IP; bill posting 5 / hour per account and
  10 / hour per IP; reports 10 / hour per account. Retries of the same
  bill form and invalid forms do not burn the posting quota.

## Run it locally

```sh
bun install     # installs dependencies (creates bun.lock)
bun run build   # builds the client into dist/client
bun run start   # serves the app on http://localhost:3000
```

On first start the server creates `./data/app.db` (empty) and applies the
migrations in `drizzle/` automatically. Open http://localhost:3000 and post
a test bill.

Other scripts:

- `bun run typecheck` — type-checks client and server.
- `bun run build:server` — bundles the server to `dist/server.js`
  (`bun dist/server.js` runs it without the TypeScript source).

## Configuration (environment variables)

| Variable | Default | What it is |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. Railway and Render set this themselves. |
| `DATABASE_PATH` | `./data/app.db` | SQLite file. **Put it on a persistent volume** (see below) or bills disappear when the container is replaced. |
| `UPLOADS_DIR` | `./data/uploads` | Where proof photos are stored. Same persistence warning. |
| `CLIENT_DIR` | `dist/client` | Built client directory. |
| `MIGRATIONS_DIR` | `drizzle/` | Drizzle migration files. |
| `ADMIN_EMAIL` | _(none)_ | Email address of the admin account. Any account with this email is an admin (promoted at signup and on every start). If unset, the first account to sign up becomes the admin. |
| `SESSION_COOKIE_SECURE` | _(unset)_ | Set to `1` when the app is served over HTTPS so the session cookie is only sent over secure connections. Leave unset for plain-HTTP local runs. |

Endpoints: `GET /` (the app), `GET /health` (returns `{"ok":true}` —
use it as the host health check), `POST /actions` (`{action, args}`),
`GET /uploads/*` (proof photos).

## Deploy

### Option A — Railway (easiest, no Docker)

1. Put this folder in a GitHub repo and push it.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
   Railway auto-detects Bun from `bun.lock`. Do not put a file named
   `Dockerfile` in the repo root — Railway picks it up and its validator
   rejects this image; the Docker file lives at `Dockerfile.render` for
   Render and local Docker use.
3. Set the service commands explicitly if they are not picked up:
   **Build Command** `bun run build`, **Start Command** `bun run start`.
4. Add a **Volume**, mount path `/app/data`. (Volumes need a paid plan.)
5. Variables: `DATABASE_PATH=/app/data/app.db`, `UPLOADS_DIR=/app/data/uploads`,
   `ADMIN_EMAIL=<the admin's email>`. `PORT` is provided by Railway — do not
   set it yourself. If the app is served over HTTPS, also set
   `SESSION_COOKIE_SECURE=1`.
6. Deploy. Open the generated domain; `/health` should return `{"ok":true}`.

### Option B — Render (Docker)

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service → Build and deploy from a Git repository** →
   pick the repo → **Runtime: Docker**, Dockerfile path `Dockerfile.render`.
   The included `Dockerfile.render` does the rest (`bun install`,
   `bun run build`, `bun run start`).
3. Add a **Persistent Disk**, mount path `/app/data`, 1 GB. (Disks need a
   paid instance type; on the free tier the database and photos live on
   ephemeral disk and are lost on redeploy.)
4. Environment variables: `DATABASE_PATH=/app/data/app.db`,
   `UPLOADS_DIR=/app/data/uploads`, `ADMIN_EMAIL=<the admin's email>`.
   `PORT` is provided by Render. If the app is served over HTTPS, also set
   `SESSION_COOKIE_SECURE=1`.
5. **Health Check Path:** `/health`.
6. Deploy and open the service URL.

### Option C — any Docker host / VPS

```sh
docker build -f Dockerfile.render -t help-pay-bills .
docker run -p 3000:3000 -v hpb-data:/app/data help-pay-bills
```

Or on a plain VPS with Bun installed: `bun install && bun run build &&
bun run start`, with `DATABASE_PATH`/`UPLOADS_DIR` pointed at a directory
that survives restarts. A process manager (systemd, pm2) and a reverse
proxy (Caddy/Nginx) with HTTPS are the host's job — this app serves plain
HTTP on `PORT`.

## What still needs doing before strangers use it together

This pass made the app **public-ready** as far as accounts, moderation, and
rate limiting go. Two things are still open:

1. **A hosting account + a persistent volume** (steps above). Without the
   volume, the SQLite file and proof photos are wiped on every redeploy.
2. **Backups** — back up the SQLite file and the uploads directory on a
   schedule (the volume is the only copy).

Things deliberately not built yet — a developer can add them later, but
they are not required for a first public launch:

- **Email verification / password reset.** Accounts work without them:
  anyone can sign up with any email address, and there is no "forgot
  password" flow. If that matters, add an email-sending service and a
  reset-token flow before announcing widely.
- **Captcha.** The rate limits slow automated sign-ups and bill spam, but
  there is no captcha on the forms.
- **Content review beyond user reports** — the admin panel is the whole
  moderation workflow right now.

## Notes and caveats

- **No data is included.** The zip starts empty. The one real bill in the
  original Muse app (an OSF medical bill posted as Brittany) is not in
  here and was never copied.
- **Proof photos are stored on local disk**, not object storage. That is
  fine for a small deployment; if the app grows, swap `storeProof` /
  `deleteProof` in `server/src/actions.ts` for S3-compatible storage.
- The first-name field's placeholder text is `Alex`, a neutral name for a
  public app.
- Sora and JetBrains Mono load from Google Fonts at runtime
  (`client/src/theme.css`); they fall back to system fonts offline.
- `recharts` is a dependency of the original app and is still listed in
  `package.json`, though the current UI does not render charts.
- The two Google Fonts are the only runtime network dependency; everything
  else is self-contained.
- This code was smoke-tested end to end on Bun 1.4.4 with a fresh empty
  database (61 functional checks + 7 rate-limit checks, all green): sign-up
  and sign-in, posting as one user and being refused as another, payment
  recording and confirmation by the poster only, reporting, hiding and
  unhiding, blocking and unblocking, rate limits on sign-in, bill posting,
  and sign-up, plus the original checks (proof photos, duplicate guards,
  payment caps, validation, restart persistence). It was **not** checked
  in a real browser; confirm the look on a phone after the first deploy.

## How it works (the trust model)

- Anyone can browse the board without signing in.
- A signed-in poster fills in biller, amount, due date, story, the biller's
  own guest payment link, and optionally a proof photo (with a warning to
  cover account numbers first). Only a first name shows publicly. The bill
  belongs to that account.
- A signed-in donor picks an amount, pays on the biller's own page, then
  returns and records the payment.
- Only the poster (or an admin) confirms each payment and marks the bill
  paid. Donor-reported payments are capped at the amount still needed.
- Any signed-in user can report a bill; an admin reviews reports and can
  hide or remove the bill and block abusive accounts.
- No money flows through the app at all.

## Project layout

```
client/                 React 19 + TanStack Query front end
  src/App.tsx           the whole UI (unchanged except the removed SDK scrim)
  src/api.ts            typed fetch client (replaces createActionClient)
  src/main.tsx          entry point, owns its QueryClient
  src/theme.css         Tailwind v4 + the futuristic dark theme
  build.mjs             Tailwind compile + Bun bundle -> dist/client
server/
  src/server.ts         Bun HTTP server: static files, /actions, /uploads,
                        session resolution, client IP
  src/actions.ts        the actions: accounts (sign up/in/out), bills,
                        payments, reports, admin (hide, block, list)
  src/auth.ts           password hashing (argon2id), cookie sessions,
                        admin promotion (ADMIN_EMAIL)
  src/ratelimit.ts      in-memory rate limits
  src/db.ts             SQLite connection + migration runner
  src/schema.ts         Drizzle schema (bills, pledges, users, sessions,
                        reports)
drizzle/                SQLite migrations 0001 + 0002 + 0003 (accounts,
                        sessions, reports, ownership, hidden flag)
Dockerfile.render       multi-stage Bun image for Render / local Docker
                        (kept out of the repo root so Railway uses
                        Nixpacks instead of Docker)
DATA-PLAN.md            the original design notes
```
