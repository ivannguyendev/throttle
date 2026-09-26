# PREPARE NODE_MODULES IN PRODUCTION MODE
FROM node:14.17-alpine as runner
WORKDIR /usr/src/app
COPY package.json ./
# COPY yarn.lockfile ./yarn.lock
RUN yarn --non-interactive --prod && yarn autoclean

# BUILD FROM SOURCE
FROM runner as builder
WORKDIR /usr/src/app
RUN npm install -g typescript@4.3.2
COPY . .
RUN yarn 
RUN yarn build:docker

# COPY FROM PREVIOUS STAGES  
FROM node:14.17-alpine
WORKDIR /usr/src/app
COPY --from=runner /usr/src/app/node_modules node_modules
COPY --from=builder /usr/src/app/dist dist
USER 1
CMD ["ls", "-al", "dist"]
