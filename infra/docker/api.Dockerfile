# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# API image. One image, four commands:
#
#   node dist/index.js                         HTTP on PORT (default 5106)
#   node dist/worker.js                        BullMQ worker (no inbound port)
#   node dist/migrate.js                       forward-only migrations (one-off task)
#   node dist/cli.js admin:create --email ...  bootstrap the first admin (one-off task)
#
#   docker build -f infra/docker/api.Dockerfile -t open-resume-api .
#
# The four entry points are esbuild bundles (pnpm --filter @open-resume/api build).
# Everything is bundled (unpdf, mammoth, ejs, docx, ...) except the packages the build
# script marks --external: sharp (a native binary, only while the API depends on it), the icon and font packages the
# renderer reads from node_modules at run time (@fortawesome/fontawesome-free,
# @fontsource/lato, @fontsource/merriweather) and, if it is marked, puppeteer-core.
# The runtime stage carries a node_modules with only those, at exactly the version the
# lockfile resolved, installed with the prebuilt binary for the platform being built
# (pg-native is never installed: pg falls back to its JS client).
#
# The same image runs the worker, which renders resume PDFs with headless Chromium. The
# browser is the Debian package (no download at install time), found through
# CHROMIUM_PATH. The container runs as the non-root `node` user, and a user
# namespace sandbox is not available inside a container, so CHROMIUM_NO_SANDBOX=1
# turns Chromium's own sandbox off; the renderer instead blocks all network requests
# and loads only data: and about: URLs.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Download every package in the lockfile first: this layer only changes with the lockfile.
# package.json too: it pins the pnpm version (packageManager) and carries the overrides
# the frozen lockfile is checked against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @open-resume/api...
RUN pnpm --filter @open-resume/api build
# The run-time packages, at the versions the workspace resolved, with prebuilt binaries
# for this platform.
RUN mkdir /native && cd /native \
 && pkgs="" \
 && for dep in @fortawesome/fontawesome-free @fontsource/lato @fontsource/merriweather; do \
      v="$(node -p "require('/repo/apps/api/node_modules/$dep/package.json').version")"; \
      pkgs="$pkgs $dep@$v"; \
    done \
 && if [ -d /repo/apps/api/node_modules/sharp ]; then \
      pkgs="$pkgs sharp@$(node -p "require('/repo/apps/api/node_modules/sharp/package.json').version")"; \
    fi \
 && if grep -q -- '--external:puppeteer-core' /repo/apps/api/package.json; then \
      pptr="$(node -p "require('/repo/apps/api/node_modules/puppeteer-core/package.json').version")"; \
      pkgs="$pkgs puppeteer-core@${pptr}"; \
    fi \
 && echo '{"name":"runtime","private":true}' > package.json \
 && PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund --no-package-lock $pkgs

FROM ${NODE_IMAGE} AS runtime
# DATA_DIR only matters for STORAGE=local or MAIL_MODE=outbox. /tmp/data suits ECS (read-only
# root filesystem, writable /tmp); compose mounts a volume at /app/data instead.
ENV NODE_ENV=production TZ=UTC PORT=5106 \
    MIGRATIONS_DIR=/app/db/migrations DATA_DIR=/tmp/data \
    CHROMIUM_PATH=/usr/bin/chromium CHROMIUM_NO_SANDBOX=1 \
    TEMPLATES_DIR=/app/dist/templates
WORKDIR /app
# tini reaps zombies and forwards SIGTERM so the server drains and the worker stops cleanly.
# chromium: renders resume HTML to PDF (worker). fonts-liberation (metric-compatible
# Arial, Times, Courier), fonts-noto-core (Latin, Greek, Cyrillic, Devanagari and other
# scripts) and fonts-noto-color-emoji keep a resume in any language from printing boxes.
# fontconfig + fonts-dejavu-core: sharp (librsvg) needs a real font, found through
# fontconfig, to draw text in SVGs (avatars); without one every glyph is a box.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates fontconfig fonts-dejavu-core \
      chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /native/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
# The EJS resume templates are read from disk at run time (TEMPLATES_DIR overrides).
COPY --from=build --chown=node:node /repo/apps/api/src/templates ./dist/templates
# The bundled runner reads MIGRATIONS_DIR (db/migrate.ts), set above.
COPY --from=build --chown=node:node /repo/db/migrations ./db/migrations
USER node
EXPOSE 5106
# Liveness for the HTTP process. The worker has no port: compose and ECS override this.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5106)+'/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
