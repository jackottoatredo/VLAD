# Stage 1: Install dependencies
FROM node:22-bookworm AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for tsx)
RUN npm ci

# Install Playwright's Chromium browser + system dependencies
RUN npx playwright install chromium --with-deps

# Stage 2: Build the Next.js application
FROM node:22-bookworm AS build

WORKDIR /app

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build Next.js — dummy env vars satisfy module-level validation during page collection
ENV SUPABASE_URL=https://placeholder.supabase.co
ENV SUPABASE_SERVICE_ROLE_KEY=placeholder
ENV S3_BUCKET=placeholder
ENV S3_ENDPOINT=https://placeholder.r2.cloudflarestorage.com
ENV S3_ACCESS_KEY_ID=placeholder
ENV S3_SECRET_ACCESS_KEY=placeholder
ENV GOOGLE_CLIENT_ID=placeholder
ENV GOOGLE_CLIENT_SECRET=placeholder
ENV NEXTAUTH_SECRET=placeholder
ENV NEXTAUTH_URL=http://localhost:3000
ENV INTERNAL_API_SECRET=placeholder
RUN npm run build

# Stage 3: Production runtime
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Install Playwright system dependencies (Chromium binary is in node_modules from deps stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libx11-xcb1 \
    libxcb1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Copy built application and dependencies
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Copy worker and source files needed at runtime
COPY --from=build /app/worker.ts ./worker.ts
COPY --from=build /app/lib ./lib
COPY --from=build /app/app/config.ts ./app/config.ts
COPY --from=build /app/types ./types

# Copy Playwright browser cache from deps stage
COPY --from=deps /root/.cache/ms-playwright /root/.cache/ms-playwright

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Default: run the Next.js web server
# Worker service overrides this with: npm run worker
CMD ["npm", "start"]
