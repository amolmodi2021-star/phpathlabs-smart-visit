-- report_share_links: short tokens for patient report access
CREATE TABLE public.report_share_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  registration_id uuid NOT NULL,
  invoice_number text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  created_by text
);
CREATE INDEX idx_report_share_links_token ON public.report_share_links(token);
CREATE INDEX idx_report_share_links_registration ON public.report_share_links(registration_id);
CREATE INDEX idx_report_share_links_created_at ON public.report_share_links(created_at DESC);

ALTER TABLE public.report_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read share links by token"
  ON public.report_share_links FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert share links"
  ON public.report_share_links FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update share links"
  ON public.report_share_links FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete share links"
  ON public.report_share_links FOR DELETE
  USING (true);

-- report_link_events: every patient action on the portal
CREATE TABLE public.report_link_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  session_id text,
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX idx_report_link_events_token ON public.report_link_events(token);
CREATE INDEX idx_report_link_events_occurred ON public.report_link_events(occurred_at DESC);
CREATE INDEX idx_report_link_events_type ON public.report_link_events(event_type);

ALTER TABLE public.report_link_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read link events"
  ON public.report_link_events FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert link events"
  ON public.report_link_events FOR INSERT
  WITH CHECK (true);

-- report_link_sessions: dwell-time tracking
CREATE TABLE public.report_link_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL UNIQUE,
  token text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  last_heartbeat_at timestamp with time zone NOT NULL DEFAULT now(),
  total_dwell_seconds integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_report_link_sessions_token ON public.report_link_sessions(token);
CREATE INDEX idx_report_link_sessions_started ON public.report_link_sessions(started_at DESC);

ALTER TABLE public.report_link_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read link sessions"
  ON public.report_link_sessions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert link sessions"
  ON public.report_link_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update link sessions"
  ON public.report_link_sessions FOR UPDATE
  USING (true);