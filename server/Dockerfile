FROM node:25-alpine
WORKDIR /app
# libstdc++ is a runtime dep of the compiled native modules (better-sqlite3,
# bcrypt); keep it. The toolchain (python3/make/g++) is only needed to build
# them, so install it as a virtual package and drop it after npm ci to keep
# the runtime image lean and reduce attack surface.
RUN apk add --no-cache libstdc++
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --workspace=server --omit=dev \
  && apk del .build-deps
COPY server/ ./server/
COPY client/ ./client/
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/ || exit 1
CMD ["node", "index.js"]
