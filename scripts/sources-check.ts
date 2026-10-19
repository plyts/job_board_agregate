/**
 * Vérifie les API d'offres réelles (France Travail, Adzuna) : jeton, format des offres, pagination, combinaison des
 * mots-clés, codes postaux, paramètres de filtre. Une dizaine de requêtes par API (quota), rien n'est enregistré.
 * Identifiants : ceux des sources connectées d'un compte (--email ; DATABASE_URL et JOBPILOT_SECRETS_KEY requises),
 * sinon FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET et ADZUNA_APP_ID / ADZUNA_APP_KEY.
 * Usage : npm run sources:check [-- --email moi@exemple.fr]
 */
import { parseArgs } from "node:util";
import { createDb, createPool } from "../src/db/client";
import { findUserByEmail } from "../src/modules/identity";
import { checkAdzuna, checkFranceTravail, type CheckLine } from "../src/modules/sources/check";
import { ADZUNA } from "../src/modules/sources/connectors/adzuna";
import { FRANCE_TRAVAIL } from "../src/modules/sources/connectors/france-travail";
import { storedApiCredentials } from "../src/modules/sources/service";

const { values } = parseArgs({ options: { email: { type: "string" } } });
const env = process.env;

let creds: Awaited<ReturnType<typeof storedApiCredentials>> = {};
if (values.email) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL est requise avec --email");
  const pool = createPool(env.DATABASE_URL);
  try {
    const db = createDb(pool);
    const user = await findUserByEmail(db, values.email);
    if (!user) throw new Error(`Aucun compte pour ${values.email}`);
    creds = await storedApiCredentials(db, user.id);
  } finally {
    await pool.end();
  }
} else {
  if (env.FRANCE_TRAVAIL_CLIENT_ID && env.FRANCE_TRAVAIL_CLIENT_SECRET) creds.franceTravail = { clientId: env.FRANCE_TRAVAIL_CLIENT_ID, clientSecret: env.FRANCE_TRAVAIL_CLIENT_SECRET };
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) creds.adzuna = { appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY };
}

const SYMBOL = { ok: "✓", warn: "!", fail: "✗" } as const;
function print(title: string, lines: CheckLine[]) {
  console.log(`\n${title}`);
  for (const l of lines) console.log(`  ${SYMBOL[l.level]} ${l.label} : ${l.detail}`);
  if (lines.some((l) => l.level === "fail")) process.exitCode = 1;
}

if (creds.franceTravail) {
  const endpoints = { tokenUrl: env.FRANCE_TRAVAIL_TOKEN_URL ?? FRANCE_TRAVAIL.tokenUrl, apiUrl: env.FRANCE_TRAVAIL_API_URL ?? FRANCE_TRAVAIL.apiUrl };
  print(`France Travail (${endpoints.apiUrl})`, await checkFranceTravail(creds.franceTravail, endpoints));
} else console.log("\nFrance Travail : non vérifié (aucun identifiant)");
if (creds.adzuna) {
  const apiUrl = env.ADZUNA_API_URL ?? ADZUNA.apiUrl;
  print(`Adzuna (${apiUrl})`, await checkAdzuna(creds.adzuna, apiUrl));
} else console.log("\nAdzuna : non vérifié (aucun identifiant)");
console.log("\n✓ conforme · ! écart à examiner (le code fonctionne peut-être moins bien) · ✗ échec");
