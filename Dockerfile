# syntax=docker/dockerfile:1
# Image unique de JobPilot : serveur web (Next.js « standalone »), worker, migrations et sauvegardes.
# Construction : docker build -t jobpilot .   (voir docs/DEPLOIEMENT.md)

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Certificat d'un proxy d'entreprise, facultatif (secret de construction, jamais copié dans l'image).
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund

# Dépendances d'exécution seulement (tsx compris, utilisé par le worker et les migrations).
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --omit=dev --no-audit --no-fund \
    # Next.js et sharp ne servent qu'au serveur web, qui embarque sa propre copie (sortie « standalone »).
    && rm -rf node_modules/next node_modules/@next node_modules/sharp node_modules/@img

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# Base d'exécution : l'image officielle PostgreSQL 16 apporte pg_dump/pg_restore de la même version majeure que le
# serveur, ainsi que bash, tar et openssl utilisés par les sauvegardes ; Node.js y est copié depuis l'image officielle.
# (Le VOLUME hérité de l'image PostgreSQL reste inutilisé.)
FROM postgres:16-trixie AS runtime
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
# rclone (binaire statique) pour la copie hors site des sauvegardes, configurée par variables RCLONE_CONFIG_*.
COPY --from=rclone/rclone:1.74.0 /usr/local/bin/rclone /usr/local/bin/rclone
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home-dir /app app \
    && node --version && pg_dump --version && rclone version | head -1
ENTRYPOINT []
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
WORKDIR /app
# Le worker et les scripts (tsx, migrations, sauvegardes) utilisent le code source et les dépendances d'exécution.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json /app/drizzle.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/.next/standalone ./web
COPY --from=build /app/.next/static ./web/.next/static
RUN mkdir -p /data/storage /backups && chown -R app:app /data /backups
USER app
EXPOSE 3000
# Par défaut : le serveur web. Worker : « npm run worker » ; migrations : « npm run db:migrate ».
CMD ["node", "web/server.js"]
