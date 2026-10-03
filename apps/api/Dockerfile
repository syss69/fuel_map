FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

COPY . .

RUN npm run build --workspace=@fuel-map/database

RUN npm run build --workspace=apps/api


FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]