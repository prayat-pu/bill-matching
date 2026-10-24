# The whole app in one image: Fastify serves the API and the built React page.
#
# The TypeScript is run directly by Node's type stripping, so there is no
# compile step for the server - only the web app is built.

# --- build the React app -----------------------------------------------------
FROM node:24-slim AS web

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/extract/package.json packages/extract/
COPY packages/workbook/package.json packages/workbook/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages packages
COPY apps apps
RUN npm run build -w @bill/web

# --- runtime -----------------------------------------------------------------
FROM node:24-slim

# pdftoppm rasterizes the receipt PDFs; sharp needs nothing else on Debian.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5174 \
    WEB_DIST=/app/apps/web/dist

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/extract/package.json packages/extract/
COPY packages/workbook/package.json packages/workbook/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev

COPY packages packages
COPY apps/server apps/server
COPY --from=web /app/apps/web/dist /app/apps/web/dist

USER node
EXPOSE 5174

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 5174) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]
