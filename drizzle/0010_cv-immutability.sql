-- Une version de CV enregistrée ne change plus, sauf pour être finalisée telle quelle ;
-- une version finalisée ne change plus du tout. La suppression du compte ou de l'offre reste possible.
CREATE FUNCTION cv_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('saved', 'finalized') THEN
    IF TG_OP = 'DELETE' THEN
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) OR NOT EXISTS (SELECT 1 FROM job_offers WHERE id = OLD.offer_id) THEN
        RETURN OLD;
      END IF;
    ELSIF OLD.status = 'saved' AND NEW.status = 'finalized' AND NEW.content = OLD.content AND NEW.version = OLD.version THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'cv version % is % and immutable', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cv_versions_immutable
  BEFORE UPDATE OR DELETE ON cv_versions
  FOR EACH ROW EXECUTE FUNCTION cv_versions_guard();
