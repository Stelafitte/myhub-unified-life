DROP INDEX IF EXISTS public.emails_account_message_unique;
CREATE UNIQUE INDEX emails_account_message_unique ON public.emails (account_id, message_id);