# Build context: repo root
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci -w @ic/shared -w @ic/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @ic/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
