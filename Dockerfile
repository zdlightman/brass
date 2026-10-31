# Minimal Cloud / CI image for Brass (Node-only path).
# Python/numpy is optional and not installed here.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Default: typecheck + smoke tests (see docs/cloud-baseline.md)
CMD ["npm", "run", "test:smoke"]
