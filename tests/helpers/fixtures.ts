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

export const CV_TEXT = `Camille Martin
Data Engineer — Lyon
camille.martin@exemple.fr · +33 6 12 34 56 78

EXPÉRIENCE
Data Engineer — Lumio (09/2023 – aujourd'hui)
- Développement et maintenance de 30 pipelines Python/SQL orchestrés par Airflow.
- Migration de l'entrepôt vers BigQuery, 4 To.
Data Engineer — Sencia (06/2021 – 08/2023)
- Ingestion quasi temps réel d'événements via Pub/Sub.

PROJETS
Pipeline Databricks Community sur données open data (2023, projet personnel).

FORMATION
Master Informatique, données — Université de Lyon — 2021

CERTIFICATIONS
Google Cloud Professional Data Engineer (2024)

COMPÉTENCES
Python, SQL, Airflow, BigQuery, Spark, Terraform

LANGUES
Français (natif), Anglais`;

export const CV_EXTRACTION = {
  fullName: "Camille Martin",
  headline: "Data Engineer",
  location: "Lyon",
  summary: null,
  experiences: [
    {
      title: "Data Engineer",
      company: "Lumio",
      location: null,
      start: "2023-09",
      end: null,
      current: true,
      missions: ["Développement et maintenance de 30 pipelines Python/SQL orchestrés par Airflow."],
      achievements: ["Migration de l'entrepôt vers BigQuery, 4 To."],
    },
    {
      title: "Data Engineer",
      company: "Sencia",
      location: null,
      start: "2021-06",
      end: "2023-08",
      current: false,
      missions: ["Ingestion quasi temps réel d'événements via Pub/Sub."],
      achievements: [],
    },
  ],
  education: [{ degree: "Master Informatique, données", school: "Université de Lyon", year: "2021" }],
  certifications: [{ name: "Google Cloud Professional Data Engineer", issuer: "Google Cloud", year: "2024", status: "obtained" as const }],
  projects: [{ name: "Pipeline Databricks Community", context: "personal" as const, description: "Pipeline sur données open data.", year: "2023" }],
  languages: [
    { name: "Français", level: "natif" },
    { name: "Anglais", level: null },
  ],
  skills: [
    { name: "Python", level: "mastered" as const, evidence: [{ section: "experience" as const, index: 0 }, { section: "experience" as const, index: 1 }] },
    { name: "Airflow", level: "mastered" as const, evidence: [{ section: "experience" as const, index: 0 }] },
    { name: "Spark", level: "learning" as const, evidence: [{ section: "project" as const, index: 0 }] },
    { name: "Terraform", level: "mastered" as const, evidence: [] },
    { name: "Kubernetes", level: "occasional" as const, evidence: [{ section: "experience" as const, index: 7 }] },
  ],
  uncertainties: [{ field: "Expérience Lumio", note: "Poste peut-être terminé en 2026." }],
};
