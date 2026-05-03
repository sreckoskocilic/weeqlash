FROM node:25-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --workspace=server --omit=dev
COPY server/ ./server/
COPY client/ ./client/
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "index.js"]
