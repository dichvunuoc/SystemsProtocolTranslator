# Build context: project root (set in docker-compose.yml)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY mock-servers/opcua-mock/ ./mock-servers/opcua-mock/

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/mock-servers/opcua-mock/ ./mock-servers/opcua-mock/
CMD ["npx", "tsx", "mock-servers/opcua-mock/server.ts"]
