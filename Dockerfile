# ==================== Stage 1: Dependencies ====================
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ARG DEBIAN_MIRROR_HOST=""

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN if [ -n "$DEBIAN_MIRROR_HOST" ]; then sed -i "s|deb.debian.org|$DEBIAN_MIRROR_HOST|g" /etc/apt/sources.list.d/debian.sources; fi \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates openssl \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm config set registry https://registry.npmmirror.com \
	&& npm install --ignore-scripts --no-audit --no-fund

# ==================== Stage 2: Build ====================
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ARG DEBIAN_MIRROR_HOST=""

# Prisma chooses its query-engine binary while generating the client. The
# builder therefore needs OpenSSL as well as the final runtime image; without
# it Prisma falls back to an OpenSSL 1.1 engine that cannot run on Bookworm.
RUN if [ -n "$DEBIAN_MIRROR_HOST" ]; then sed -i "s|deb.debian.org|$DEBIAN_MIRROR_HOST|g" /etc/apt/sources.list.d/debian.sources; fi \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates openssl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma generate + Next.js build + Worker bundle
RUN npm run build

# ==================== Stage 3: Production (no source code) ====================
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG DEBIAN_MIRROR_HOST=""

# Install runtime media tools used by canvas video enhancement / subtitle erasing.
RUN if [ -n "$DEBIAN_MIRROR_HOST" ]; then sed -i "s|deb.debian.org|$DEBIAN_MIRROR_HOST|g" /etc/apt/sources.list.d/debian.sources; fi \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates ffmpeg openssl tini \
	&& rm -rf /var/lib/apt/lists/*

# ---- 只安装生产依赖 ----
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/prisma ./prisma
RUN npm config set registry https://registry.npmmirror.com \
	&& npm install --omit=dev --ignore-scripts --no-audit --no-fund \
	&& npx prisma generate

# Next.js 构建产物
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Worker / Watchdog / Board 编译产物（JS，无 TypeScript 源码）
COPY --from=builder /app/dist ./dist

# 生产启动脚本
COPY --from=builder /app/scripts/docker-start.sh ./docker-start.sh
COPY --from=builder /app/scripts/guards/fixed-tos-config-guard.mjs ./fixed-tos-config-guard.mjs
RUN chmod +x ./docker-start.sh

# 定价和配置标准
COPY --from=builder /app/standards ./standards

# 提示词模板（运行时数据，非源码）
COPY --from=builder /app/lib ./lib

# 国际化 + 配置文件
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/middleware.ts ./middleware.ts

# 运行日志目录 + 空 .env（node --env-file=.env 需要文件存在，实际 env 由 docker-compose 注入）
RUN mkdir -p /app/logs && touch /app/.env

EXPOSE 3000 3010

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./docker-start.sh"]
