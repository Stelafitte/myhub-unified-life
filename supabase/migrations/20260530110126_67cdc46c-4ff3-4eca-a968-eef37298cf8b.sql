
CREATE TABLE IF NOT EXISTS public.deleted_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  message_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, message_id)
);

CREATE INDEX IF NOT EXISTS deleted_emails_account_idx ON public.deleted_emails(account_id);

GRANT SELECT, INSERT, DELETE ON public.deleted_emails TO authenticated;
GRANT ALL ON public.deleted_emails TO service_role;

ALTER TABLE public.deleted_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own deleted_emails all"
  ON public.deleted_emails FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger: when an email is deleted, store a tombstone so IMAP sync won't re-create it.
CREATE OR REPLACE FUNCTION public.track_deleted_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.message_id IS NOT NULL AND OLD.account_id IS NOT NULL THEN
    INSERT INTO public.deleted_emails (user_id, account_id, message_id)
    VALUES (OLD.user_id, OLD.account_id, OLD.message_id)
    ON CONFLICT (account_id, message_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS emails_track_delete ON public.emails;
CREATE TRIGGER emails_track_delete
  BEFORE DELETE ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.track_deleted_email();
