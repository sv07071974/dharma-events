# Multi-stage build for the API service.
FROM node:20-alpine AS base
WORKDIR /repo
# Alpine's base node image ships without OpenSSL, which Prisma's query
# engine needs to detect the correct engine binary at both `prisma
# generate` time (build stage) and runtime (this stage) - without it,
# Prisma silently falls back to a mismatched engine and the process
# crashes on client init. Installed here (in `base`) so build and runtime
# stages share an identical OpenSSL version.
RUN apk add --no-cache openssl && \
    # Alpine 3.21+ moved libssl.so.3/libcrypto.so.3 from /lib to /usr/lib,
    # but Prisma's platform-detection script still looks in /lib and
    # silently mis-detects OpenSSL as absent (defaulting to a mismatched
    # "openssl-1.1.x" engine, which then crashes on first query) even
    # though OpenSSL 3.x is actually installed. Symlinking into the old
    # location is the documented workaround until upstream Prisma/Alpine
    # fix the detection script.
    ln -sf /usr/lib/libssl.so.3 /lib/libssl.so.3 && \
    ln -sf /usr/lib/libcrypto.so.3 /lib/libcrypto.so.3
# `corepack enable` alone isn't enough for the *runtime* stage below: that
# stage never copies the root package.json (only compiled app/package
# dirs), so corepack has nothing to read the pinned "packageManager"
# version from and falls back to fetching the latest pnpm - which now
# requires a newer Node than this image ships, crashing with
# ERR_UNKNOWN_BUILTIN_MODULE. `corepack prepare ... --activate` pins the
# exact pnpm version as the default regardless of package.json lookup, so
# commands like `docker compose run --rm api pnpm prisma:deploy` keep working.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile --filter @dharma-events/api... --filter @dharma-events/database

FROM deps AS build
COPY . .
RUN pnpm --filter @dharma-events/database exec prisma generate
RUN pnpm --filter @dharma-events/shared build
RUN pnpm --filter @dharma-events/database build
RUN pnpm --filter @dharma-events/api build

# packages/shared and packages/database ship source-pointing "main"/"exports"
# fields (so dev/test tooling like tsx/vitest resolves straight to src/*.ts
# without a build step). The compiled runtime image instead needs those
# fields repointed at the just-built dist/ output, or plain `node` fails
# with ERR_UNKNOWN_FILE_EXTENSION trying to import raw .ts files.
RUN node -e "\
const fs = require('fs'); \
for (const p of ['packages/shared/package.json', 'packages/database/package.json']) { \
  const j = JSON.parse(fs.readFileSync(p, 'utf8')); \
  j.main = './dist/index.js'; \
  if (j.exports) { for (const k of Object.keys(j.exports)) { j.exports[k] = j.exports[k].replace('./src/', './dist/').replace('.ts', '.js'); } } \
  fs.writeFileSync(p, JSON.stringify(j, null, 2)); \
}"

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/packages/database /repo/packages/database
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/api /repo/apps/api
COPY --from=build /repo/node_modules /repo/node_modules
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
