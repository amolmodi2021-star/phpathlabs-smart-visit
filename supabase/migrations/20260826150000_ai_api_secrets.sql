-- Store AI provider API keys for LIMS Settings UI (service_role only; not readable by anon).

CREATE TABLE IF NOT EXISTS public.ai_api_secrets (
  provider text PRIMARY KEY,
  api_key text NOT NULL,
  model_override text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE public.ai_api_secrets ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies: only service_role (edge functions) can read/write.
DROP POLICY IF EXISTS "ai_api_secrets_deny_all" ON public.ai_api_secrets;
-- With RLS on and no grants to anon, PostgREST clients cannot access rows.
REVOKE ALL ON TABLE public.ai_api_secrets FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_api_secrets FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_api_secrets TO service_role;

COMMENT ON TABLE public.ai_api_secrets IS
  'AI API keys managed from LIMS Settings. Readable only via service_role edge functions.';
