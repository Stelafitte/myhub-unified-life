-- Required for upsert in sync-imap edge function
CREATE UNIQUE INDEX IF NOT EXISTS emails_account_message_unique
  ON public.emails (account_id, message_id)
  WHERE message_id IS NOT NULL;