# Public demo deployment

The submission needs a public demo and a public renderer. These are the two
supported paths. Nothing here is automatic; you choose the host and domain.

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

## Option B — Vercel web + a Node API host

1. Deploy `web` to Vercel with Root Directory `web`; set the `NEXT_PUBLIC_*` variables
   (and `API_INTERNAL_URL` to the public API URL).
2. Deploy `server` to Render/Fly/any Node host:
   ```bash
   pnpm --filter server build
   pnpm --filter server start
   ```
   Set `PORT`, `GATE_SECRET`, `CORS_ORIGIN=<web origin>` and the RPC/contract vars.
3. Set the renderer and refresh metadata with the commands above.
4. Verify the wallet flow and the lounge on the public origin.

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
