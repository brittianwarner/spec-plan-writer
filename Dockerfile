# Optional: long-lived Rivet Compute / self-hosted runner image.
#
# Default topology is Vercel serverless (`/api/rivet/*` in the SvelteKit app).
# Use this image only if agentOS runs need a process that outlives serverless
# function limits: `npx @rivetkit/cli deploy` (runner mode).
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
