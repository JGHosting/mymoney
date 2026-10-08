# FinTS-Brücke – schlankes Image, läuft als nicht privilegierter Benutzer
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache tzdata && mkdir /data && chown node:node /data
ENV NODE_ENV=production TZ=Europe/Berlin HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- --header="Authorization: Bearer $BRIDGE_TOKEN" http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
