import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 8788);
console.log(`Mutapixels server :${PORT}`);
serve({ fetch: app.fetch, port: PORT });
