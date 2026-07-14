FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY public ./public
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM node:20-bookworm-slim AS production

ENV NODE_ENV=production \
    PORT=3000 \
    PARKRUN_DATA_DIR=/data \
    PARKRUN_PROFILE_DIR=/tmp/parkrun-browser-profile \
    PARKRUN_HEADLESS=true \
    PARKRUN_WORKERS=1 \
    PARKRUN_REQUEST_DELAY_MS=1250 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY scripts ./scripts
COPY server.js ./

RUN mkdir -p /data /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chmod +x /app/scripts/container-entrypoint.sh \
    && chown -R node:node /app /data
USER node

EXPOSE 3000 6080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
CMD ["node", "server.js"]
