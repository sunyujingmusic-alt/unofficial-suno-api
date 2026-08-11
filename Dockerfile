FROM node:lts-bookworm AS builder
WORKDIR /src
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:lts-bookworm
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Copy full node_modules from builder (avoids npm --omit=dev bug in npm 11)
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/.next ./.next
COPY --from=builder /src/public ./public
COPY --from=builder /src/package*.json ./
COPY --from=builder /src/package-lock.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/docs').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
