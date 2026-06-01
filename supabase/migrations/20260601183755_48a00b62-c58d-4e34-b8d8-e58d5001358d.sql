-- Auto-create tombstones whenever an email row is deleted (hard delete)
-- OR soft-deleted (deleted_at set). Without this, IMAP/Gmail/Outlook
-- re-import the same message at the next sync.

DROP TRIGGER IF EXISTS trg_track_deleted_email ON public.emails;
CREATE TRIGGER trg_track_deleted_email
BEFORE DELETE ON public.emails
FOR EACH ROW EXECUTE FUNCTION public.track_deleted_email();

CREATE OR REPLACE FUNCTION public.track_soft_deleted_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL
     AND (OLD.deleted_at IS NULL)
     AND NEW.message_id IS NOT NULL
     AND NEW.account_id IS NOT NULL THEN
    INSERT INTO public.deleted_emails (user_id, account_id, message_id)
    VALUES (NEW.user_id, NEW.account_id, NEW.message_id)
    ON CONFLICT (account_id, message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_soft_deleted_email ON public.emails;
CREATE TRIGGER trg_track_soft_deleted_email
AFTER UPDATE OF deleted_at ON public.emails
FOR EACH ROW EXECUTE FUNCTION public.track_soft_deleted_email();

-- Backfill tombstones for already-soft-deleted emails
INSERT INTO public.deleted_emails (user_id, account_id, message_id)
SELECT user_id, account_id, message_id
FROM public.emails
WHERE deleted_at IS NOT NULL
  AND message_id IS NOT NULL
  AND account_id IS NOT NULL
ON CONFLICT (account_id, message_id) DO NOTHING;