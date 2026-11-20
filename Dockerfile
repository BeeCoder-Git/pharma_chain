# Multi-Stage Production Dockerfile for PharmaTrust Platform
FROM node:20-alpine AS builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root user
USER node

# Copy installed dependencies and source code
COPY --chown=node:node --from=builder /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend

WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
