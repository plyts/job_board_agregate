// Point d'extension commun aux tests (variables d'environnement de test, etc.).
process.env.TZ = "Europe/Paris";
// Clé de chiffrement des identifiants des sources, propre aux tests.
process.env.JOBPILOT_SECRETS_KEY ??= Buffer.alloc(32, 1).toString("base64");
