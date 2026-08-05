FROM node:20-alpine

# Install OpenSSL system-wide in Alpine so Prisma engine binaries link correctly
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files and prisma schema first.
# Docker caches this layer so npm install only re-runs when dependencies change.
COPY package*.json ./
COPY prisma ./prisma/

# npm install also runs postinstall → prisma generate, which builds the
# Prisma client from the schema. This must happen before copying src/,
# because the generated client code lives in node_modules.
RUN npm install

COPY . .

EXPOSE 3001

# Default command — docker-compose overrides this with the prisma push + start chain.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx tsx prisma/seed.ts && npx tsx src/server.ts"]
