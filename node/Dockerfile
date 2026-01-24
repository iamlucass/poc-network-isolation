FROM oven/bun:1.3-alpine AS base

WORKDIR /app

COPY ./package.json ./bun.lock ./

RUN bun install --production --frozen-lockfile

FROM oven/bun:1.3-distroless AS runtime

WORKDIR  /app

COPY --from=base /app/node_modules ./node_modules
COPY ./server /app

USER nonroot

EXPOSE 3000

CMD ["/app/index.ts"]
