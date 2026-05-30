UPDATE public.accounts
SET last_sync_at = now() - interval '8 days'
WHERE id IN (
  'a3e93280-02ca-4f42-b5ba-da534349bc11',
  '745f107f-a87e-4a57-9e49-00d9a32b815a',
  '8f2183a4-3252-480d-9c2f-dbaad069529b'
);