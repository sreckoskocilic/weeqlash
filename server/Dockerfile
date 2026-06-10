FROM node:25-alpine
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
