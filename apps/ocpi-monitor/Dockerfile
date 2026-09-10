# SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

FROM node:20-slim AS build
WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:20-slim
RUN npm install -g serve
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]