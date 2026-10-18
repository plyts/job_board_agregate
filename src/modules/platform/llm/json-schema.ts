import { z } from "zod";

type Json = Record<string, unknown>;

// Mots-clés mal ou non pris en charge par les modes « structured outputs » des API compatibles OpenAI.
// Les contraintes retirées restent vérifiées par Zod à la réception.
const UNSUPPORTED = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "default"];

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (UNSUPPORTED.includes(key)) continue;
    out[key] = key === "properties" && value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, strictify(v)]))
      : strictify(value);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties as Json);
    out.additionalProperties = false;
  }
  return out;
}

/** JSON Schema « strict » : chaque objet fermé, chaque propriété requise (les champs facultatifs sont nullables). */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  return strictify(z.toJSONSchema(schema, { target: "draft-7" })) as Json;
}
