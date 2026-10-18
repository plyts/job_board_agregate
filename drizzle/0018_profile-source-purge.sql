-- Conservation limitée (RGPD) : le texte et le fichier source d'un CV importé peuvent être effacés d'une
-- version validée ; tout le reste de la version validée reste immuable.
CREATE OR REPLACE FUNCTION profile_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'validated' THEN
    IF TG_OP = 'DELETE' THEN
      -- La suppression en cascade du compte reste possible.
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
        RETURN OLD;
      END IF;
    ELSIF NEW.source_text IS NULL AND NEW.source_file_key IS NULL
      AND (OLD.source_text IS NOT NULL OR OLD.source_file_key IS NOT NULL)
      AND (to_jsonb(NEW) - 'source_text' - 'source_file_key') = (to_jsonb(OLD) - 'source_text' - 'source_file_key') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'profile version % is validated and immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
