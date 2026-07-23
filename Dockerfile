FROM node:lts-bookworm AS builder
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:lts-bookworm
WORKDIR /app
# Copy full node_modules from builder (avoids npm --omit=dev bug in npm 11)
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/.next ./.next
COPY --from=builder /src/public ./public
COPY --from=builder /src/package*.json ./
COPY --from=builder /src/package-lock.json ./
EXPOSE 3000
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "start"]
