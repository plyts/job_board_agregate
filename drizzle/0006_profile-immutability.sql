-- Une version validée du profil maître ne peut plus être modifiée ni supprimée (hors suppression du compte).
CREATE FUNCTION profile_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'validated' THEN
    IF TG_OP = 'DELETE' THEN
      -- La suppression en cascade du compte reste possible.
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'profile version % is validated and immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER profile_versions_immutable
  BEFORE UPDATE OR DELETE ON profile_versions
  FOR EACH ROW EXECUTE FUNCTION profile_versions_guard();
