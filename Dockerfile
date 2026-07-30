# spec-plan-writer · actor backend for Rivet Compute
#
# The SvelteKit frontend deploys separately to Vercel; this image runs ONLY
# the Rivet actor registry (user / specPlan / specPlanRun / specPlanWorker /
# agentOS vm) as a long-lived Node process.
#
# Deploy:  npx @rivetkit/cli deploy --token cloud_api_xxxxx
#
# node:24-slim (glibc — the agentOS sidecar ships no musl build) + toolchain
# for the native deps (isolated-vm, better-sqlite3) when no prebuild exists.
FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY rivetkit-svelte ./rivetkit-svelte
RUN npm ci --omit=dev

COPY src/lib ./src/lib
COPY src/server ./src/server

# Rivet Compute injects RIVET_PORT; registry.start() reads it (default 3000).
EXPOSE 3000

CMD ["node", "src/server/actor-server.ts"]
