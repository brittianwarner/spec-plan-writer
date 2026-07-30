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
> so it cannot be the agentOS mount. Set `BLOB_READ_WRITE_TOKEN` on the **Rivet
> Compute** host to privately upload finished SPEC.md artifacts.

---

## How a run works

```
browser ──WS──▶ specPlan actor  (fan-in: phase / roster / logs / doc)
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

Actors (Rivet Cloud, hosted on **Rivet Compute**):

| Actor | Key | Purpose |
| --- | --- | --- |
| `user` | `["user", userId]` | GitHub profile + tokens, OpenRouter key, plan directory (SQLite) |
| `specPlan` | `["specPlan", userId, planId]` | Browser fan-in: phase, roster, worker logs, instructions, versioned docs |
| `specPlanRun` | `["specPlanRun", userId, planId, runId]` (internal-only) | Durable workflow: provision → plan → fan-out → synthesize → persist |
| `specPlanWorker` | `["specPlanWorker", …, roleId]` (internal-only) | One pi specialist; failure-isolated domain |
| `vm` | `["vm", userId, planId]` (internal-only) | Shared agentOS VM for the plan |

Frontend deploys to **Vercel**. Actor backend deploys to **Rivet Compute** via
Docker (`npx @rivetkit/cli deploy`). Locally it's two processes that mirror that
split.

---

## Quickstart (local)

**Requirements:** Node 24+, a [GitHub OAuth App](https://github.com/settings/developers),
an OpenRouter key (per user, entered in the app after login).

```bash
cp .env.example .env
# fill GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / AUTH_SECRET / INTERNAL_SECRET

npm install

# terminal 1 — actor backend (local Rivet engine on :6420)
npm run dev:actors

# terminal 2 — SvelteKit frontend on :5173
npm run dev
```

Open http://localhost:5173 → **login --github** → paste OpenRouter key →
new plan.

OAuth App settings for local:

- Homepage URL: `http://localhost:5173`
- Callback URL: `http://localhost:5173/auth/github/callback`
- Scopes requested by the app: `read:user`, `repo`

---

## Deploy

### 1. Actor backend → Rivet Compute

```bash
# Dockerfile at repo root builds the actor server (node:24-slim + native deps)
npx @rivetkit/cli deploy --token cloud_api_xxxxx
```

Set the actor-side secrets in the Rivet project (or pool env):

- `AUTH_SECRET`, `INTERNAL_SECRET` (must match frontend)
- optional `SPEC_S3_*` for the shared filesystem mount
- optional `SPEC_PLAN_MODEL` / `PI_MODEL` / `SPEC_PLAN_MAX_PARALLEL`

The container just calls `registry.start()` and listens on `RIVET_PORT`.

### 2. Frontend → Vercel

Connect the repo, framework preset SvelteKit. Env vars:

| Var | Where |
| --- | --- |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App (callback = `https://<your-app>/auth/github/callback`) |
| `AUTH_SECRET` / `INTERNAL_SECRET` | same values as Rivet Compute |
| `RIVET_ENDPOINT` | Rivet Cloud `sk_` URL-auth endpoint |
| `RIVET_PUBLIC_ENDPOINT` | Rivet Cloud `pk_` endpoint (browser WS) |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |
| `APP_URL` | `https://your-app.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | auto when you attach a Blob store (optional) |
| `SPEC_S3_*` | only needed on the **actor** host, not Vercel |

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
      registry.ts
    ai/                OpenRouter verify + roster planner
    github/            profile / repos / PR helpers
    client/            browser Rivet wiring (@rivetkit/svelte)
    server/            session cookie, OAuth, Rivet client
    stores/            Svelte 5 $state classes
    ui/                terminal frame, log pane, markdown, …
  routes/
    (app)/             ssr=false realtime shell
      dashboard/ new/ plan/[planId]/
    auth/github/       OAuth
    api/actor-token/   short-lived HS256 for actor connections
  server/actor-server.ts   Rivet Compute entrypoint
rivetkit-svelte/       vendored @rivetkit/svelte (from euchre)
Dockerfile             Rivet Compute image
```

---

## Scripts

```bash
npm run dev            # SvelteKit
npm run dev:actors     # actor backend (node, type-stripped .ts)
npm run check          # svelte-check
npm run test           # vitest unit tests (prompts, pi config, session log)
npm run build          # Vercel-bound frontend
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
- **Blob**: private uploads; token on the Rivet host.
- Status lines and worker panes run through `redactSecrets`.

---

## Why this topology

The [euchre](https://github.com) app proved RivetKit actors can run serverless
inside a Vercel function. That works for light game logic — it is a poor fit for
agentOS. agentOS runs a WASM VM, clones repos, and holds multi-minute pi sessions
inside the runner process. Those want a long-lived container:

- **Rivet Compute** hosts the actor registry (Docker, `registry.start()`).
- **Vercel** hosts the SvelteKit UI (SSR auth, OAuth, token minting).
- The browser opens its Rivet WebSocket **direct to Rivet Cloud** with the
  publishable `pk_` endpoint — same discovery model as euchre, just without the
  `/api/rivet` mount.

See also: [Rivet actor design patterns](https://rivet.dev/docs/actors/design-patterns/),
[events](https://rivet.dev/docs/actors/events/), [state](https://rivet.dev/docs/actors/state/),
[agentOS workflows](https://agentos-sdk.dev/docs/workflows/).

---

Apache-2.0-friendly; vibe-coded for the community. Bring your own keys.
