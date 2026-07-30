# spec-plan-writer

A public multi-agent **spec plan writer**.

Sign in with GitHub, paste your OpenRouter key, pick a repo, describe a change —
then watch a grid of specialist workers draft a grounded Markdown plan together
and open it as a PR.

Built to showcase three pieces of the modern agent stack:

| Layer | Tech | Role |
| --- | --- | --- |
| Durable agents | **[Rivet Actors](https://rivet.dev/docs/actors/crash-course/)** | Per-user identity, per-plan brain, durable generation workflow, one worker per specialist |
| Coding runtime | **[agentOS](https://agentos-sdk.dev/docs/crash-course/) + Pi** | Shared VM per plan — filesystem, shell, multiplayer sessions |
| Shared storage | **S3-compatible mount** (+ optional **Vercel Blob** artifacts) | Repo + sections + notes survive sleep/wake; finished SPEC.md can land on Blob |

> **Storage note.** The shared agent filesystem uses a real S3-compatible API
> (`SPEC_S3_*`) at `plans/<userId>/<planId>/`. Vercel Blob is not S3-API-compatible,
> so it cannot be the agentOS mount. Optional `BLOB_READ_WRITE_TOKEN` uploads
> finished SPEC.md artifacts privately.

---

## How a run works

```
browser ──WS──▶ Rivet Cloud ──HTTPS──▶ /api/rivet/* (this app)
                     │
              specPlan actor  (fan-in: phase / roster / logs / doc)
                     │
                     │ startRun()
                     ▼
                specPlanRun  (durable workflow)
                     │
         ┌───────────┼────────────────────────┐
         ▼           ▼                        ▼
      provision   plan roster            synthesize
    (vm + S3 +   (OpenRouter LLM          (pi session
     git clone)   ranks specialists)       pairs sections)
                     │
                     ▼
               fan-out ≤ N
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    worker A     worker B     worker C     …  each is a pi session
         │           │           │            on the SAME agentOS VM
         └───────────┴───────────┘
                     │
            shared filesystem
    /home/agentos/work/repo
    /home/agentos/work/plan/sections/<role>.md
    /home/agentos/work/plan/notes/<role>.md
    /home/agentos/work/plan/SPEC.md
```

Workers talk to each other through the filesystem — notes for coordination,
sections for ownership — which is the agentOS [multiplayer](https://agentos-sdk.dev/docs/multiplayer/)
model in one machine.

### Editable instructions

Every plan owns a block of **house rules** you can edit (`DEFAULT_INSTRUCTIONS`
seeds a new plan). They are injected into all three prompt sites — the roster
planner, every specialist worker, and the synthesizer — so one edit changes the
whole team's behavior:

- Edit them on the **new plan** screen before the first run.
- Edit them on the **plan** screen any time; the run actor snapshots the rules
  when a run starts, so an edit mid-run lands on the *next* run.
- They ride in a fenced `<instructions>` block, clamped to 4 000 chars, kept
  separate from the mechanical parts of the prompt.

Actors (serverless pool on this deployment via `/api/rivet`):

| Actor | Key | Purpose |
| --- | --- | --- |
| `user` | `["user", userId]` | GitHub profile + tokens, OpenRouter key, plan directory (SQLite) |
| `specPlan` | `["specPlan", userId, planId]` | Browser fan-in: phase, roster, worker logs, instructions, versioned docs |
| `specPlanRun` | `["specPlanRun", userId, planId, runId]` (internal-only) | Durable workflow: provision → plan → fan-out → synthesize → persist |
| `specPlanWorker` | `["specPlanWorker", …, roleId]` (internal-only) | One pi specialist; failure-isolated domain |
| `vm` | `["vm", userId, planId]` (internal-only) | Shared agentOS VM for the plan |

One SvelteKit app on **Vercel** — UI and Rivet serverless runner in the same
deployable ([docs](https://rivet.dev/docs/deploy/vercel)). The browser never
terminates a WebSocket on Vercel; Rivet Cloud does the WS, then HTTPS-calls
back into `/api/rivet/*`.

---

## Quickstart (local)

**Requirements:** Node 24+, a [GitHub OAuth App](https://github.com/settings/developers),
an OpenRouter key (per user, entered in the app after login).

```bash
cp .env.example .env
# fill GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / AUTH_SECRET / INTERNAL_SECRET

npm install
npm run dev          # SvelteKit + local Rivet engine (:6420) → /api/rivet
```

Open **http://127.0.0.1:5173** (IPv4 — Vite binds `127.0.0.1` so the local
Rivet engine can call back into `/api/rivet`) → **login --github** → paste
OpenRouter key → new plan.

OAuth App settings for local:

- Homepage URL: `http://127.0.0.1:5173`
- Callback URL: `http://127.0.0.1:5173/auth/github/callback`
- Scopes requested by the app: `read:user`, `repo`

Leave `RIVET_*` empty. RivetKit starts the local engine and
`configurePool` points it at `http://127.0.0.1:5173/api/rivet`.

> If login hangs or redirects with `?error=auth_failed`, check the Vite terminal
> for `[auth/github/callback] failed`. Common local causes: Vite only on IPv6
> while the engine hits `127.0.0.1`, or another process already owns `:6420`.

Optional long-lived alternate: `npm run dev:actors` + Dockerfile for Rivet
Compute runner mode (not required for the default serverless path).

---

## Deploy (Vercel serverless)

1. Create a [Rivet Cloud](https://dashboard.rivet.dev) project and grab Cloud API
   tokens (`sk_` + `pk_`) in **Settings → Advanced → Cloud API Tokens**.
2. Connect this repo to Vercel (SvelteKit preset).
3. Set env vars:

| Var | Notes |
| --- | --- |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App callback = `https://<app>/auth/github/callback` |
| `AUTH_SECRET` / `INTERNAL_SECRET` | `openssl rand -hex 32` each |
| `RIVET_ENDPOINT` | `https://<ns>:sk_****@api.rivet.dev` (**required** on Vercel) |
| `RIVET_PUBLIC_ENDPOINT` | `https://<ns>:pk_****@api.rivet.dev` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |
| `APP_URL` | `https://your-app.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | optional Blob store |
| `SPEC_S3_*` | optional shared agent FS |

4. In Rivet, configure a **serverless provider** whose URL is
   `https://your-app.vercel.app/api/rivet` (or use
   [`rivet-dev/preview-namespace-action`](https://github.com/rivet-dev/preview-namespace-action)
   for PR previews). Leave **all** pool fields at Rivet defaults except:
   - `request_lifespan` — keep/autoset under Vercel `maxDuration` (**300s** here;
     dashboard often lands on ~295). Do not raise above the function limit.
   - `drain_grace_period` — default **1800s** is invalid with a ~300s lifespan.
     Set grace to **~10–30s** only (rule: grace **<** lifespan). Everything
     else stays default.
5. If **Vercel Deployment Protection** is on, add header
   `x-vercel-protection-bypass` on the Rivet provider (see
   [deploy docs](https://rivet.dev/docs/deploy/vercel#troubleshooting)).

`/api/rivet` sets `maxDuration: 300` so agentOS wakes are less likely to be cut
short (requires a Vercel plan that allows it; Hobby is lower).

---

## Repo map

```
src/
  lib/
    protocol/          shared wire types (browser ↔ actors)
    actors/            Rivet + agentOS definitions
      user/            profile, key, plan directory
      spec-plan/       browser fan-in brain
      spec-plan-run/   durable workflow + pi provision
      spec-plan-worker/
      vm.ts            agentOS({ software: [pi] })
      registry.ts      setup + local startEngine/configurePool
    ai/                OpenRouter verify + roster planner
    github/            profile / repos / PR helpers
    client/            browser Rivet → `${origin}/api/rivet`
    server/            session cookie, OAuth, Rivet client
    stores/            Svelte 5 $state classes
    ui/                terminal frame, log pane, markdown, …
  routes/
    (app)/             ssr=false realtime shell
      dashboard/ new/ plan/[planId]/
    auth/github/       OAuth
    api/actor-token/   short-lived HS256 for actor connections
    api/rivet/[...all] serverless mount (metadata + start)
  server/actor-server.ts   optional Rivet Compute entrypoint
vite-plugin-rivet-dev.ts   preserves binary /start body in Vite
rivetkit-svelte/       vendored @rivetkit/svelte (from euchre)
Dockerfile             optional Rivet Compute runner image
```

---

## Scripts

```bash
npm run dev            # SvelteKit + local serverless Rivet (one process)
npm run dev:actors     # optional: long-lived registry.start() runner
npm run check          # svelte-check
npm run test           # vitest unit tests (prompts, pi config, session log)
npm run build          # Vercel-bound build
npm run smoke:openrouter  # optional live key check
```

---

## Security model

Aligned with Rivet's [production checklist](https://rivet.dev/docs/general/production-checklist/)
and agentOS [permissions](https://agentos-sdk.dev/docs/permissions/) /
[approvals](https://agentos-sdk.dev/docs/approvals/):

- **Deny-by-default actor access**
  - Browser JWT only opens `user` + `specPlan` (IDOR on `key[1]`).
  - `specPlanRun`, `specPlanWorker`, and `vm` accept **internal secret only**.
  - VM keys are `["vm", userId, planId]` — never bare planId.
- **agentOS kernel policy** is the security boundary for unattended specialists:
  network deny-by-default (OpenRouter + Github only); `.git/**` + `/proc`/`/sys`
  denied; env deny-by-default except essentials + `OPENROUTER_API_KEY`.
- **ACP `permissionPolicy: allow_all`** auto-resolves tool prompts for unattended
  workers; kernel permissions remain the FS/network boundary (approvals docs).
- **Credentials**
  - Keys live only on the user actor; DTOs never return them.
  - OpenRouter key injected into the pi *session* env only
    ([models & credentials](https://agentos-sdk.dev/docs/models-and-credentials/)).
  - Git clone uses a one-shot `http.extraHeader` Auth bearer (never a
    `x-access-token:…@` remote that lands in `.git/config`), then scrubs origin.
  - Logout calls `user.clearSecrets`.
- **Cancel is authoritative**: late `commitDoc` refuses after cancel / activeRunId
  mismatch; run actor fences synth/persist on `cancelRequested`.
- **Quotas**: `LIMITS.maxPlansPerUser` (25).
- **Blob**: private uploads.
- Status lines and worker panes run through `redactSecrets`.

---

## Why this topology

Same as [euchre](https://github.com/brittianwarner/euchre) and the
[Vercel deploy guide](https://rivet.dev/docs/deploy/vercel): one app, Rivet
serverless mode, `/api/rivet` handler. Desktop-short game logic fits easily;
agentOS + multi-minute pi sessions run inside the same `/start` lifespan
(`maxDuration: 300`). If a run regularly outlives Vercel limits, the optional
Docker/`registry.start()` runner path remains as an escape hatch.

See also: [Rivet runtime modes](https://rivet.dev/docs/general/runtime-modes),
[actor design patterns](https://rivet.dev/docs/actors/design-patterns/),
[agentOS workflows](https://agentos-sdk.dev/docs/workflows/).

---

Apache-2.0-friendly; vibe-coded for the community. Bring your own keys.
