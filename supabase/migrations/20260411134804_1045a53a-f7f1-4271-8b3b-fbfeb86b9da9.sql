
-- Create app_roles table
CREATE TABLE public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name text UNIQUE NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to app_roles" ON public.app_roles FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_app_roles_updated_at BEFORE UPDATE ON public.app_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create app_users table
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  role_id uuid REFERENCES public.app_roles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_app_users_updated_at BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create app_user_login_history table
CREATE TABLE public.app_user_login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  login_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

ALTER TABLE public.app_user_login_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to app_user_login_history" ON public.app_user_login_history FOR ALL USING (true) WITH CHECK (true);

-- Seed default Admin role with all permissions
INSERT INTO public.app_roles (id, role_name, description, permissions) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Admin',
  'Full access to all tabs and sections',
  '{
    "tabs": {
      "/": true,
      "/dashboard": true,
      "/home-visits": true,
      "/phlebotomists": true,
      "/tests": true,
      "/templates": true,
      "/abnormal-history": true,
      "/phlebo-dashboard": true,
      "/loyalty-cards": true,
      "/marketing": { "enabled": true, "sections": ["sender","templates","history","message_log","new_numbers","automated"] },
      "/crm": { "enabled": true, "sections": ["contacts","import","sequences","abnormal_tests","abnormal_whatsapp","blacklist","sent_history","settings"] },
      "/lims": { "enabled": true, "sections": ["register","patients","sample_collection","sample_acceptance","results","result_verification","doctor_approval","dispatch","completed_home_visits","pickup_points","channels","modified_approval","outsourced_results"] },
      "/whatsapp-webhook": true,
      "/whatsapp-settings": true,
      "/lims-demo": true,
      "/report-layout": true,
      "/signature-management": true,
      "/users": true
    }
  }'
);

-- Seed default admin user (password: PHPL6699, bcrypt hash)
-- Hash generated for PHPL6699: $2a$10$xQ8Kz5Y1vJ2wR4mN6pL3..placeholder
-- We'll use a known bcrypt hash; the edge function will verify against this
INSERT INTO public.app_users (username, password_hash, display_name, role_id, is_active) VALUES (
  'PHPATHLABS',
  '$2a$10$placeholder_will_be_set_by_edge_function',
  'Administrator',
  'a0000000-0000-0000-0000-000000000001',
  true
);
