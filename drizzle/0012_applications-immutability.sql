-- Le fichier envoyé et l'historique d'une candidature ne se modifient ni ne se suppriment,
-- sauf avec la suppression du compte.
CREATE FUNCTION application_append_only_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER application_documents_immutable
  BEFORE UPDATE OR DELETE ON application_documents
  FOR EACH ROW EXECUTE FUNCTION application_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER application_events_append_only
  BEFORE UPDATE OR DELETE ON application_events
  FOR EACH ROW EXECUTE FUNCTION application_append_only_guard();
