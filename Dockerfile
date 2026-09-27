# Compiles src/ to dist/ without a local Node.js or pnpm.
# docker-compose.yml copies the result back to the host.
FROM node:24-alpine
WORKDIR /usr/src/app

# pnpm from npm, not corepack: Node.js stops bundling corepack from v25.
RUN npm install -g pnpm@12.6.0

# Dependencies first, so a source edit reuses the cached install layer.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build:docker
