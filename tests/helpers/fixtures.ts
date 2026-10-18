import type { OfferExtraction } from "../../src/modules/analysis/schema";

export const OFFER_TEXT = `Senior Data Engineer
Nordwave construit la plateforme de données de ses clients industriels.
Profil : au moins 5 ans d'expérience en ingénierie des données, maîtrise de Python et SQL.
Expérience significative de Spark (Databricks). dbt et Kafka sont un plus.
Poste basé à Lyon, 3 jours par semaine sur site. Rémunération selon profil.`;

export const EXTRACTION: OfferExtraction = {
  title: "Senior Data Engineer",
  company: "Nordwave",
  location: "Lyon",
  requirements: [
    { kind: "years", importance: "mandatory", label: "Expérience en data", value: "5 ans", minYears: 5, provenance: "explicit", quote: "au moins 5 ans d'expérience en ingénierie des données", rationale: null },
    { kind: "hard_skill", importance: "mandatory", label: "Python et SQL", value: "maîtrise", minYears: null, provenance: "explicit", quote: "maîtrise de Python et SQL", rationale: null },
    { kind: "tech", importance: "preferred", label: "dbt", value: null, minYears: null, provenance: "explicit", quote: "dbt et Kafka sont un plus", rationale: null },
    { kind: "tech", importance: "mandatory", label: "Kubernetes", value: null, minYears: null, provenance: "explicit", quote: "Kubernetes en production", rationale: null },
    { kind: "remote", importance: "condition", label: "Présence sur site", value: "3 jours par semaine", minYears: null, provenance: "explicit", quote: "3 jours par semaine sur site", rationale: null },
  ],
  notMentioned: ["salary", "clearance"],
};
