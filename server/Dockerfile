FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
# libstdc++: runtime dep of native modules (better-sqlite3, bcrypt).
# tini: PID 1, forwards SIGTERM to node for graceful shutdown.
RUN apk add --no-cache libstdc++ tini
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --workspace=server --omit=dev \
  && apk del .build-deps
COPY server/ ./server/
COPY client/ ./client/
WORKDIR /app/server
# Unprivileged node user (uid 1000). Host ./data must be owned by uid 1000.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
