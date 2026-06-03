UPDATE public.profiles p
SET onboarding_completed_at = now()
WHERE onboarding_completed_at IS NULL
  AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id = p.id);