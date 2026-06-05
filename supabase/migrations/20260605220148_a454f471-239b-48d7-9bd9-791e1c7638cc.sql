
ALTER TABLE public.collab_spaces
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wa_group_name text;

DELETE FROM public.collab_spaces;

-- NIVEAU 0
INSERT INTO public.collab_spaces (id, user_id, name, description, type, icon, color, level, position) VALUES
('a1000000-0000-0000-0000-000000000001', (SELECT id FROM public.profiles LIMIT 1), 'CNPCV', 'Comité National de Prévention Cardio-Vasculaire', 'project', '🏛️', '#6366f1', 0, 1),
('a1000000-0000-0000-0000-000000000002', (SELECT id FROM public.profiles LIMIT 1), 'SFC', 'Société Française de Cardiologie', 'project', '🫀', '#ef4444', 0, 2),
('a1000000-0000-0000-0000-000000000003', (SELECT id FROM public.profiles LIMIT 1), 'UMCV', 'Unité Médico-Chirurgicale Cardiovasculaire', 'project', '🏥', '#3b82f6', 0, 3),
('a1000000-0000-0000-0000-000000000004', (SELECT id FROM public.profiles LIMIT 1), 'DFSAM', 'DFSAM', 'project', '🎓', '#f59e0b', 0, 4),
('a1000000-0000-0000-0000-000000000005', (SELECT id FROM public.profiles LIMIT 1), 'Recherche', 'Projets de recherche', 'project', '🔬', '#10b981', 0, 5),
('a1000000-0000-0000-0000-000000000006', (SELECT id FROM public.profiles LIMIT 1), 'Publications', 'Publications scientifiques', 'project', '📝', '#8b5cf6', 0, 6),
('a1000000-0000-0000-0000-000000000007', (SELECT id FROM public.profiles LIMIT 1), 'RAA', 'Rhumatisme Articulaire Aigu', 'project', '🩺', '#ec4899', 0, 7);

-- NIVEAU 1
INSERT INTO public.collab_spaces (user_id, name, description, type, icon, color, level, position, parent_id) VALUES
((SELECT id FROM public.profiles LIMIT 1), 'CNPCV Global', 'Espace global CNPCV', 'project', '🌐', '#6366f1', 1, 1, 'a1000000-0000-0000-0000-000000000001'),
((SELECT id FROM public.profiles LIMIT 1), 'Comité FMC CP', 'Comité Formation Médicale Continue', 'project', '📚', '#818cf8', 1, 2, 'a1000000-0000-0000-0000-000000000001'),
((SELECT id FROM public.profiles LIMIT 1), 'SFC Global', 'Espace global SFC', 'project', '🌐', '#ef4444', 1, 1, 'a1000000-0000-0000-0000-000000000002'),
((SELECT id FROM public.profiles LIMIT 1), 'Commission Formation', 'Commission formation SFC', 'project', '🎓', '#f87171', 1, 2, 'a1000000-0000-0000-0000-000000000002'),
((SELECT id FROM public.profiles LIMIT 1), 'Cercle Cardio IA', 'Cercle IA - SFC', 'project', '🤖', '#dc2626', 1, 3, 'a1000000-0000-0000-0000-000000000002'),
((SELECT id FROM public.profiles LIMIT 1), 'UMCV Global', 'Espace global UMCV', 'project', '🌐', '#3b82f6', 1, 1, 'a1000000-0000-0000-0000-000000000003'),
((SELECT id FROM public.profiles LIMIT 1), 'UMCV Echo', 'Unité échographie UMCV', 'project', '📡', '#60a5fa', 1, 2, 'a1000000-0000-0000-0000-000000000003'),
((SELECT id FROM public.profiles LIMIT 1), 'RHD Pacific Network', 'Réseau RHD Pacifique', 'project', '🌏', '#34d399', 1, 1, 'a1000000-0000-0000-0000-000000000005'),
((SELECT id FROM public.profiles LIMIT 1), 'DU RAA', 'Diplôme Universitaire RAA', 'project', '🎓', '#f472b6', 1, 1, 'a1000000-0000-0000-0000-000000000007');

UPDATE public.collab_spaces SET wa_group_name = 'Cercle IA de la SFC' WHERE name = 'Cercle Cardio IA';
UPDATE public.collab_spaces SET wa_group_name = 'RHD Pacific Network' WHERE name = 'RHD Pacific Network';
UPDATE public.collab_spaces SET wa_group_name = 'DU RAA' WHERE name = 'DU RAA';

-- NIVEAU 2 : groupes WA
INSERT INTO public.collab_spaces (user_id, name, description, type, icon, color, level, position, parent_id, wa_group_name)
SELECT
  (SELECT id FROM public.profiles LIMIT 1),
  s.name, s.descr, 'project', '📱', '#25d366', 2, s.pos,
  (SELECT id FROM public.collab_spaces WHERE name = s.parent LIMIT 1),
  s.wa
FROM (VALUES
  ('WA : Codir Cercle Cardio IA', 'Groupe WhatsApp Codir', 'Cercle Cardio IA', 'Codir cercle cardio IA', 1),
  ('WA : Bureau 2026-2028', 'Groupe WhatsApp Bureau', 'Cercle Cardio IA', 'Bureau 2026-2028', 2),
  ('WA : UMCV Fullteam', 'Groupe WhatsApp UMCV Fullteam', 'UMCV Global', 'UMCV Fullteam', 1),
  ('WA : UMCV Médecins Seniors', 'Groupe WhatsApp UMCV Seniors', 'UMCV Global', 'UMCV Medecins Seniors', 2),
  ('WA : Com Hebdo Internes', 'Groupe WhatsApp Com Hebdo', 'UMCV Global', 'Com hebdo internes', 3)
) AS s(name, descr, parent, wa, pos);
