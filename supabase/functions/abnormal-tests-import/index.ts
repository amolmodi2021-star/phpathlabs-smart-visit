import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Stub: referenced in config.toml; not implemented.
serve((_req) =>
  new Response(JSON.stringify({ error: "stub: abnormal-tests-import not implemented" }), {
    status: 501,
    headers: { "Content-Type": "application/json" },
  }),
);
