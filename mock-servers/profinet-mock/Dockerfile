FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY mock-servers/profinet-mock/ ./mock-servers/profinet-mock/
COPY tsconfig.json ./

EXPOSE 34964

CMD ["npx", "tsx", "mock-servers/profinet-mock/server.ts"]
