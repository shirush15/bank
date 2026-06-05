# --- build stage: install all deps, generate Prisma client, compile TS ---
FROM node:20-slim AS builder
WORKDIR /app

# Prisma needs OpenSSL present to pick its query engine.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# --- runtime stage: slim image with only what's needed to run ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Reuse the installed deps + generated client from the build stage. This keeps
# the Prisma CLI available so `migrate deploy` can run on startup.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000

# Apply any pending migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
