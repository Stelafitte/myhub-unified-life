CREATE OR REPLACE TRIGGER calendar_events_set_updated_at
BEFORE UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();