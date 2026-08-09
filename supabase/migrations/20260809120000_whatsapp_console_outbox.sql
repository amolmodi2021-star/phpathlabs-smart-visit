-- Outbox bridge: LIMS enqueues WhatsApp sends; WhatsApp Console claims & delivers.
CREATE TABLE IF NOT EXISTS public.whatsapp_console_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'invoice',
  phone text NOT NULL,
  patient_name text,
  registration_id uuid REFERENCES public.patient_registrations(id) ON DELETE SET NULL,
  invoice_number text,
  caption text,
  media_url text,
  media_mime text DEFAULT 'image/jpeg',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'cancelled')),
  claimed_at timestamptz,
  claimed_by text,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_console_outbox_pending
  ON public.whatsapp_console_outbox (status, created_at)
  WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_wa_console_outbox_reg
  ON public.whatsapp_console_outbox (registration_id);

ALTER TABLE public.whatsapp_console_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on whatsapp_console_outbox" ON public.whatsapp_console_outbox;
CREATE POLICY "Allow all on whatsapp_console_outbox"
  ON public.whatsapp_console_outbox FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.whatsapp_console_outbox IS
  'Queue of WhatsApp messages for WhatsApp Console middleware to send (invoice images, etc).';
