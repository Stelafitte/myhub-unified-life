ALTER TABLE public.email_themes ADD COLUMN parent_id uuid REFERENCES public.email_themes(id) ON DELETE SET NULL;
CREATE INDEX email_themes_parent_idx ON public.email_themes(user_id, parent_id);
ALTER TABLE public.email_themes ADD CONSTRAINT email_themes_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id);