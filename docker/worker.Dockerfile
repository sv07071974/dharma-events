# Multi-stage build for the background worker service.
FROM node:20-alpine AS base
WORKDIR /repo
# See docker/api.Dockerfile for why this is needed at both build and
# runtime for Prisma's query engine to load correctly on Alpine 3.21+.
RUN apk add --no-cache openssl && \
    ln -sf /usr/lib/libssl.so.3 /lib/libssl.so.3 && \
    ln -sf /usr/lib/libcrypto.so.3 /lib/libcrypto.so.3
# See docker/api.Dockerfile for why `--activate` is required here (the
# runtime stage below never copies the root package.json, so corepack
# can't otherwise discover the pinned pnpm version and would fetch latest,
# which requires a newer Node than this image ships).
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile --filter @dharma-events/worker... --filter @dharma-events/database

FROM deps AS build
COPY . .
RUN pnpm --filter @dharma-events/database exec prisma generate
RUN pnpm --filter @dharma-events/shared build
RUN pnpm --filter @dharma-events/database build
RUN pnpm --filter @dharma-events/worker build

# See docker/api.Dockerfile for why this repointing is necessary: shared/
# database ship source-pointing "main"/"exports" for dev/test ergonomics,
# but plain `node` in the runtime image needs the compiled dist/ output.
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
COPY --from=build /repo/apps/worker /repo/apps/worker
COPY --from=build /repo/node_modules /repo/node_modules
WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]
