-- Journal des décisions sur les offres : jamais modifié ; supprimé seulement avec l'offre ou le compte.
CREATE FUNCTION offer_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) OR NOT EXISTS (SELECT 1 FROM job_offers WHERE id = OLD.offer_id)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'offer_events is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_events_append_only
  BEFORE UPDATE OR DELETE ON offer_events
  FOR EACH ROW EXECUTE FUNCTION offer_events_guard();
--> statement-breakpoint
-- Reprise de l'existant : une décision déjà prise est datée de la dernière mise à jour de l'offre.
INSERT INTO offer_events (user_id, offer_id, type, occurred_at)
SELECT user_id, id, CASE WHEN status = 'qualified' THEN 'qualified'::offer_event_type ELSE 'discarded'::offer_event_type END, updated_at
FROM job_offers
WHERE status IN ('qualified', 'discarded');
