CREATE TABLE public.meeting_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  deadline timestamp with time zone,
  status text NOT NULL DEFAULT 'open',
  public_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_polls TO authenticated;
GRANT SELECT ON public.meeting_polls TO anon;
GRANT ALL ON public.meeting_polls TO service_role;
ALTER TABLE public.meeting_polls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meeting_polls all" ON public.meeting_polls FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read meeting_polls by token" ON public.meeting_polls FOR SELECT TO anon USING (true);
CREATE TRIGGER meeting_polls_updated_at BEFORE UPDATE ON public.meeting_polls FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.meeting_poll_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.meeting_polls(id) ON DELETE CASCADE,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  location text,
  is_online boolean NOT NULL DEFAULT false,
  online_provider text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_poll_slots TO authenticated;
GRANT SELECT ON public.meeting_poll_slots TO anon;
GRANT ALL ON public.meeting_poll_slots TO service_role;
ALTER TABLE public.meeting_poll_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meeting_poll_slots all" ON public.meeting_poll_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meeting_polls p WHERE p.id = poll_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meeting_polls p WHERE p.id = poll_id AND p.user_id = auth.uid()));
CREATE POLICY "public read meeting_poll_slots" ON public.meeting_poll_slots FOR SELECT TO anon USING (true);

CREATE TABLE public.meeting_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.meeting_polls(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.meeting_poll_slots(id) ON DELETE CASCADE,
  voter_email text NOT NULL,
  voter_name text,
  vote text NOT NULL DEFAULT 'yes' CHECK (vote IN ('yes','no','maybe')),
  is_internal boolean NOT NULL DEFAULT false,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(slot_id, voter_email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_poll_votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_poll_votes TO anon;
GRANT ALL ON public.meeting_poll_votes TO service_role;
ALTER TABLE public.meeting_poll_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manage meeting_poll_votes" ON public.meeting_poll_votes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meeting_polls p WHERE p.id = poll_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meeting_polls p WHERE p.id = poll_id AND p.user_id = auth.uid()));
CREATE POLICY "public read meeting_poll_votes" ON public.meeting_poll_votes FOR SELECT TO anon USING (true);
CREATE POLICY "public insert meeting_poll_votes" ON public.meeting_poll_votes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "public update own vote" ON public.meeting_poll_votes FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE TABLE public.meeting_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 15,
  responsible_email text,
  responsible_name text,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_agenda_items TO authenticated;
GRANT ALL ON public.meeting_agenda_items TO service_role;
ALTER TABLE public.meeting_agenda_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meeting_agenda_items all" ON public.meeting_agenda_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER meeting_agenda_items_updated_at BEFORE UPDATE ON public.meeting_agenda_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_meeting_polls_meeting ON public.meeting_polls(meeting_id);
CREATE INDEX idx_meeting_poll_slots_poll ON public.meeting_poll_slots(poll_id);
CREATE INDEX idx_meeting_poll_votes_poll ON public.meeting_poll_votes(poll_id);
CREATE INDEX idx_meeting_poll_votes_slot ON public.meeting_poll_votes(slot_id);
CREATE INDEX idx_meeting_agenda_items_meeting ON public.meeting_agenda_items(meeting_id);