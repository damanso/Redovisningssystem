# Produktionsbild för API:t (serverrenderad vy + REST + MCP-kärna).
# Två steg: bygg med full toolchain, kör med enbart prod-beroenden och icke-root.
#
# Kärnfakta som bilden måste respektera:
#  - API:t ansluter som den lågprivilegierade rollen `app` (RLS tvingas). Migreringar
#    körs som ägar-/adminrollen via DATABASE_ADMIN_URL. Se docker/start.sh.
#  - Uppladdade filer (kvitton m.m.) skrivs till UPLOAD_DIR — montera en beständig
#    volym där (Railway Volume på /data), annars försvinner de vid varje deploy.
#  - Fail-fast: servern startar aldrig utan JWT_SECRET (≥32 tecken).

# ---- Byggsteg ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Lockfil + manifest först för lagercache på beroenden.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci
# Källkod och bygg (tsc → server/dist).
COPY server ./server
RUN npm run build
# Rensa dev-beroenden (tsx, typescript, vitest …) — kvar blir bara runtime.
RUN npm prune --omit=dev

# ---- Körsteg ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# gosu för att släppa root efter att volymens ägarskap rättats (signal-säkert exec).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app -d /app app
# Prod-beroenden (hoisted till root-node_modules i workspace-monorepot), byggd kod,
# migreringar och manifest.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY --from=build /app/server/package.json ./package.json
COPY docker/start.sh ./start.sh
RUN chmod +x start.sh && mkdir -p /data/uploads && chown -R app:app /app /data
ENV PORT=3000
ENV UPLOAD_DIR=/data/uploads
EXPOSE 3000
# Egen healthcheck via Nodes globala fetch (ingen curl i slim-bilden).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# start.sh körs som root enbart för att migrera + rätta volymägarskap, och släpper
# sedan till den icke-privilegierade `app`-användaren för själva serverprocessen.
CMD ["./start.sh"]
