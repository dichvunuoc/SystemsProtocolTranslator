FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ ./src/
EXPOSE 3000 3001
CMD ["npx", "tsx", "src/index.ts"]
