
CREATE TABLE public.landing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 100),
  last_name  text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 100),
  email      text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 255),
  institution text CHECK (institution IS NULL OR char_length(institution) <= 255),
  specialty   text CHECK (specialty IS NULL OR char_length(specialty) <= 255),
  message     text CHECK (message IS NULL OR char_length(message) <= 4000),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','contacted','approved','rejected')),
  ip_address  text,
  user_agent  text,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now()
);

GRANT INSERT ON public.landing_requests TO anon;
GRANT INSERT ON public.landing_requests TO authenticated;
GRANT ALL ON public.landing_requests TO service_role;

ALTER TABLE public.landing_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can submit (form is public)
CREATE POLICY "public can submit landing requests"
  ON public.landing_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "admins can view landing requests"
  ON public.landing_requests
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can update / delete
CREATE POLICY "admins can update landing requests"
  ON public.landing_requests
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete landing requests"
  ON public.landing_requests
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE TRIGGER landing_requests_set_updated_at
BEFORE UPDATE ON public.landing_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_landing_requests_created_at ON public.landing_requests (created_at DESC);
CREATE INDEX idx_landing_requests_status     ON public.landing_requests (status);
