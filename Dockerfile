FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/src/config/device-map.json ./dist/src/config/device-map.json
EXPOSE 3000 3001
CMD ["node", "dist/src/index.js"]
