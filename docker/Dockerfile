# ── builder ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /workspace

# Enable pnpm via corepack (version pinned in root package.json)
RUN corepack enable

# Copy workspace manifest + lock file first for cache efficiency
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json       ./packages/shared/
COPY packages/server/package.json       ./packages/server/
COPY packages/cli/package.json          ./packages/cli/
COPY packages/mcp-server/package.json   ./packages/mcp-server/

# Install only server + transitive deps (skips CLI's tree-sitter native build)
RUN pnpm install --frozen-lockfile --filter=@codebase-analysis/server...

# Copy source and build (server + shared only)
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/
COPY tsconfig.base.json ./
RUN pnpm --filter=@codebase-analysis/server... build

# Produce prod-only flat node_modules for the server package (pnpm v10: --legacy)
RUN pnpm deploy --legacy --filter=@codebase-analysis/server --prod /deploy

# Copy compiled output (build writes to dist/, not src/)
RUN cp -r packages/server/dist /deploy/dist

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=builder /deploy /app

# Create non-root user data dir
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 3000

CMD ["node", "dist/dev.js"]
