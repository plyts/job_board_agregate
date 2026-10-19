import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

export class SecretsUnavailableError extends Error {
  constructor() {
    super("JOBPILOT_SECRETS_KEY n'est pas configurée : génère-la avec « openssl rand -base64 32 » (voir .env.example).");
    this.name = "SecretsUnavailableError";
  }
}

/** Clé AES-256 lue dans l'environnement (32 octets en base64), jamais en base. */
export function secretsKey(env: Env = process.env): Buffer | null {
  const raw = env.JOBPILOT_SECRETS_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function secretsConfigured(env: Env = process.env): boolean {
  return secretsKey(env) !== null;
}

/**
 * Chiffre un objet (clés d'API, mot de passe d'application) en AES-256-GCM.
 * `context` (utilisateur et source) est authentifié : un secret recopié sur une autre ligne ne se déchiffre pas.
 */
export function encryptSecret(value: Record<string, string>, context: string, env: Env = process.env): string {
  const key = secretsKey(env);
  if (!key) throw new SecretsUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(blob: string, context: string, env: Env = process.env): Record<string, string> {
  const key = secretsKey(env);
  if (!key) throw new SecretsUnavailableError();
  const [version, iv, tag, data] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Secret illisible");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, string>;
}
