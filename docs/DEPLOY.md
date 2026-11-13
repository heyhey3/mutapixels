# Public demo deployment

The submission needs a public demo and a public renderer. These are the two
supported paths. Nothing here is automatic; you choose the host and domain.

> **Current demo (2026-11-13):** the web is deployed on **Vercel** at
> <https://mutapixels.vercel.app>. Its API is still the temporary Cloudflare quick
> tunnel <https://difference-modes-amino-ellen.trycloudflare.com>; the v2 renderer
> points at that tunnel's `/api/render`. The Vercel production env already contains
> the tunnel URL. Once Render is live, update `NEXT_PUBLIC_API_URL` and
> `API_INTERNAL_URL` in Vercel, redeploy, and point `set_renderer_base` at the Render
> `/api/render`. Quick tunnels have no uptime guarantee and change URL on restart.

## Option A — one host with Docker Compose

Prerequisites: Docker, a testnet NEAR account with the contracts already deployed,
and `server/.env` filled from `server/.env.example`.

```bash
cp server/.env.example server/.env
# Fill GATE_SECRET, RPC and contract IDs. Do not set CORS_ORIGIN to "*" publicly.
docker compose up --build -d
curl http://localhost:8788/api/health
curl http://localhost:3001/
```

The compose file builds:

- `api`: `server/Dockerfile` → `:8788`
- `web`: `web/Dockerfile` → host `:3001` (container `:3000`)

For a real host, replace `localhost:3001` in `CORS_ORIGIN` and
`NEXT_PUBLIC_API_URL` with the public web/API origins, rebuild the web image (the
public API URL is baked into the client bundle), and put both services behind HTTPS.
The metadata fetch inside the web container uses `API_INTERNAL_URL=http://api:8788`;
keep that on the compose network.

Then set the public renderer as the owner (from the repo machine):

```bash
near contract call-function as-transaction v2.mutapixels-192217.testnet \
  set_renderer_base json-args '"https://<api-host>/api/render"' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as mutapixels-192217.testnet network-config testnet \
  sign-with-legacy-keychain send

near contract call-function as-transaction v2.mutapixels-192217.testnet \
  refresh_metadata_batch json-args '{"from_index":null,"limit":50}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as mutapixels-192217.testnet network-config testnet \
  sign-with-legacy-keychain send
```

Verify `nft_token("1")` now returns a media URL under the public API, and that
`https://<api-host>/api/render/v2.mutapixels-192217.testnet/1.svg` loads.

## Option B — Vercel web + Render API (chosen)

This is the selected path. Both services need the human to sign in once.

1. **Render API**
   - Open <https://dashboard.render.com/blueprints>, **New Blueprint**, connect
     `heyhey3/mutapixels`, and apply the committed `render.yaml`.
   - It builds `server` on the free Node plan and exposes
     `https://mutapixels-api.onrender.com` (or the actual name Render shows).
   - The blueprint generates a stable `GATE_SECRET`; set `CORS_ORIGIN` after the
     Vercel URL is known.
   - The free plan spins down when idle; the first request can take ~30s. The
     in-memory rate-limit/challenge state resets on restart.
2. **Vercel web**
   - Import `heyhey3/mutapixels` at <https://vercel.com/new>, set **Root Directory =
     `web`**, framework **Next.js**, and set:
     ```
     NEXT_PUBLIC_API_URL=https://<api-host>
     API_INTERNAL_URL=https://<api-host>
     NEXT_PUBLIC_NFT_ID=v2.mutapixels-192217.testnet
     NEXT_PUBLIC_MUT_ID=mut-token-192217.testnet
     NEXT_PUBLIC_REF_ID=ref-finance-101.testnet
     NEXT_PUBLIC_REF_POOL_ID=2946
     ```
   - Deploy and copy the production URL.
3. **Close the CORS loop**
   - In Render → mutapixels-api → Environment, set
     `CORS_ORIGIN=https://<web-host>` and save/restart.
4. **Set the public renderer** with the owner account (commands above), pointing at
   `https://<api-host>/api/render`.
5. **Smoke test** `/api/health`, `/pixels/1`, `/ref`; connect a testnet wallet and run
   one feed/tip. Then post the X thread and submit.

If the Vercel build cannot resolve the pnpm workspace lockfile from `web`, set the
project Root Directory to the repository root and use the `web` output/Next preset, or
deploy the `web/Dockerfile` to a container host instead.

## What the public host must do

- Run the API over HTTPS; the web and API origins must be allowed by `CORS_ORIGIN`.
- Keep `GATE_SECRET` stable; otherwise lounge sessions reset on restart.
- Keep the API/renderer alive through judging (at least 2026-11-25).
- Use a single instance or move the rate-limit/challenge stores to a shared store;
  the current implementation is in-memory per process.
- Never upload `.env`, `~/.near-credentials`, the gate secret or a deployer key.

## Smoke test

```bash
curl -s https://<api-host>/api/health
curl -s https://<api-host>/api/pixels/1
curl -s "https://<api-host>/api/ref/quote?direction=buy&amount=10000000000000000000000"
# open https://<web-host>/pixels/1 and https://<web-host>/ref
```
