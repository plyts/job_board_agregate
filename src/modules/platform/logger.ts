import pino from "pino";

/**
 * Journal JSON structuré. Les champs sensibles sont masqués ; le contenu des CV et des offres
 * ne doit jamais être journalisé (seulement des identifiants et des empreintes).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.JOBPILOT_PROCESS ?? "web" },
  redact: {
    paths: ["password", "token", "*.password", "*.token", "headers.cookie", "headers.authorization", "apiKey"],
    censor: "[masqué]",
  },
});

export type Logger = typeof logger;
