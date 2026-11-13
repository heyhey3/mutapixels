import { app } from "@/server/app";

// The Hono API is mounted in the same Next.js deployment as the web app.
// Same origin means no CORS, and the holder lounge, renderer, and Ref reads
// use the same Vercel project.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  return app.fetch(request);
}

export async function POST(request: Request) {
  return app.fetch(request);
}

export async function OPTIONS(request: Request) {
  return app.fetch(request);
}
