# Public demo deployment

The submission needs a public demo and a public renderer. The chosen deployment is
**one Vercel project** for both the Next.js web and the Hono API.

> **Current demo (2026-11-13):** <https://mutapixels.vercel.app> — web and API are
> live on Vercel. The Hono app is mounted at
> `web/src/app/api/[...path]/route.ts`, so `/api/*` is same-origin (no CORS or second
> host). The v2 renderer points at `https://mutapixels.vercel.app/api/render`.

## Vercel (current)

The project is `mutapixels` under the `hey-0643` Vercel scope. It was deployed from
`web`; the project Root Directory is currently unset. If you import the repo fresh,
set **Root Directory = `web`** and framework **Next.js**.

1. Keep `web/src/server` in sync with the server source:

   ```bash
   ./scripts/sync-web-server.sh
   ```

2. Set the Vercel production env:

   ```
   NEXT_PUBLIC_API_URL=https://mutapixels.vercel.app
   API_INTERNAL_URL=https://mutapixels.vercel.app
   NEXT_PUBLIC_NFT_ID=v2.mutapixels-192217.testnet
   NEXT_PUBLIC_MUT_ID=mut-token-192217.testnet
   NEXT_PUBLIC_REF_ID=ref-finance-101.testnet
   NEXT_PUBLIC_REF_POOL_ID=2946
   GATE_SECRET=<fresh random secret>
   GATE_RECIPIENT=mutapixels-lounge
   NEAR_RPC_URL=https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com
   NFT_CONTRACT_ID=v2.mutapixels-192217.testnet
   MUT_TOKEN_ID=mut-token-192217.testnet
   REF_CONTRACT_ID=ref-finance-101.testnet
   REF_POOL_ID=2946
   RATE_LIMIT_CAPACITY=300
   WRAP_CONTRACT_ID=wrap.testnet
   ```

3. Deploy from `web`:

   ```bash
   cd web
   npx vercel deploy --prod --yes
   ```

4. Set the public renderer as the owner (from the repo machine):

   ```bash
   near contract call-function as-transaction v2.mutapixels-192217.testnet \
     set_renderer_base json-args '{"renderer_base":"https://mutapixels.vercel.app/api/render"}' \
     prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
     sign-as mutapixels-192217.testnet network-config testnet \
     sign-with-legacy-keychain send

   near contract call-function as-transaction v2.mutapixels-192217.testnet \
     refresh_metadata_batch json-args '{"from_index":null,"limit":50}' \
     prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
     sign-as mutapixels-192217.testnet network-config testnet \
     sign-with-legacy-keychain send
   ```

5. Smoke test:

   ```bash
   curl -s https://mutapixels.vercel.app/api/health
   curl -s https://mutapixels.vercel.app/api/pixels/1
   curl -s "https://mutapixels.vercel.app/api/ref/quote?direction=buy&amount=10000000000000000000000"
   # open https://mutapixels.vercel.app/pixels/1 and /ref
   ```

The API runs as Vercel Functions. `GATE_SECRET` must stay stable; the holder-lounge
challenge is a signed, short-lived token. The in-memory used-challenge/rate-limit
state is best-effort per function instance; see the README limitations.

## Option B — one host with Docker Compose

Prerequisites: Docker, a testnet NEAR account with the contracts already deployed,
and `server/.env` filled from `server/.env.example`.

```bash
cp server/.env.example server/.env
# Fill GATE_SECRET, RPC and contract IDs.
docker compose up --build -d
curl http://localhost:8788/api/health
curl http://localhost:3001/
```

The compose file builds:

- `api`: `server/Dockerfile` → `:8788`
- `web`: `web/Dockerfile` → host `:3001` (container `:3000`)

For a real host, set the web's public API URL (or use the embedded Next API route with
an empty `NEXT_PUBLIC_API_URL` and `API_PROXY_TARGET`), put the web behind HTTPS, and
keep `API_INTERNAL_URL` reachable from the web container. Then set the renderer with
the commands above, using the public web/API origin.

## What the public host must do

- Keep `GATE_SECRET` stable; otherwise lounge challenges/sessions reset.
- Keep the deployment live through judging (at least 2026-11-25).
- Vercel Functions are stateless; the used-challenge and rate-limit stores are
  per-instance/best-effort. A stricter deployment would use Vercel KV/Upstash.
- Never upload `.env`, `~/.near-credentials`, the gate secret or a deployer key.
