-- Rattachement rétroactif des tâches sans source_email_id à leur mail source
-- par similarité de titre (trigram).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

WITH candidates AS (
  SELECT
    t.id AS task_id,
    e.id AS email_id,
    similarity(
      lower(regexp_replace(coalesce(t.title, ''), '^(fwd:|fw:|re:|tr:|rep:)\s*', '', 'i')),
      lower(regexp_replace(coalesce(e.subject, ''), '^(fwd:|fw:|re:|tr:|rep:)\s*', '', 'i'))
    ) AS score,
    row_number() OVER (
      PARTITION BY t.id
      ORDER BY similarity(
        lower(regexp_replace(coalesce(t.title, ''), '^(fwd:|fw:|re:|tr:|rep:)\s*', '', 'i')),
        lower(regexp_replace(coalesce(e.subject, ''), '^(fwd:|fw:|re:|tr:|rep:)\s*', '', 'i'))
      ) DESC,
      e.received_at DESC NULLS LAST
    ) AS rn
  FROM public.tasks t
  JOIN public.emails e
    ON e.user_id = t.user_id
   AND e.deleted_at IS NULL
   AND coalesce(e.subject, '') <> ''
  WHERE t.source_email_id IS NULL
    AND coalesce(t.title, '') <> ''
    AND (e.received_at IS NULL OR e.received_at <= t.created_at + INTERVAL '7 days')
)
UPDATE public.tasks t
SET source_email_id = c.email_id
FROM candidates c
WHERE c.task_id = t.id
  AND c.rn = 1
  AND c.score >= 0.45;