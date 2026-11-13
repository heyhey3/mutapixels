FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY server/package.json server/
RUN pnpm install --filter web... --frozen-lockfile
COPY web web
ARG NEXT_PUBLIC_API_URL=http://localhost:8788
ARG NEXT_PUBLIC_NFT_ID=v2.mutapixels-192217.testnet
ARG NEXT_PUBLIC_MUT_ID=mut-token-192217.testnet
ARG NEXT_PUBLIC_REF_ID=ref-finance-101.testnet
ARG NEXT_PUBLIC_REF_POOL_ID=2946
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_NFT_ID=$NEXT_PUBLIC_NFT_ID \
    NEXT_PUBLIC_MUT_ID=$NEXT_PUBLIC_MUT_ID \
    NEXT_PUBLIC_REF_ID=$NEXT_PUBLIC_REF_ID \
    NEXT_PUBLIC_REF_POOL_ID=$NEXT_PUBLIC_REF_POOL_ID
RUN pnpm --filter web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/node_modules ./web/node_modules
COPY --from=build /app/web/.next ./web/.next
COPY --from=build /app/web/package.json ./web/package.json
COPY --from=build /app/web/next.config.ts ./web/next.config.ts
COPY --from=build /app/web/tsconfig.json ./web/tsconfig.json
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
WORKDIR /app/web
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
