import { describe, expect, it } from "vitest";
import { dedupKey } from "@/modules/offers/ingest";
import { decryptSecret, encryptSecret } from "@/modules/platform/secrets";
import { normalizeAdzuna } from "@/modules/sources/connectors/adzuna";
import { careerPageUrl, detectCareerPage, matchesQuery, normalizeGreenhouse, normalizeLever } from "@/modules/sources/connectors/career-pages";
import { departementCode } from "@/modules/sources/connectors/departements";
import { normalizeFranceTravail, searchParams } from "@/modules/sources/connectors/france-travail";
import { BOARDS, boardForSender, matchOffer } from "@/modules/sources/email/boards";
import { extractOffers } from "@/modules/sources/email/parse";
import { mergeResults } from "@/modules/sources/service";

const KEY = { JOBPILOT_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64") };
const board = (id: string) => BOARDS.find((b) => b.id === id)!;
const query = { keywords: "data engineer", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 };

describe("secrets des sources", () => {
  it("chiffre et déchiffre, et refuse un secret recopié sur une autre source", () => {
    const blob = encryptSecret({ clientSecret: "s3cr3t" }, "u1:france_travail", KEY);
    expect(blob).not.toContain("s3cr3t");
    expect(decryptSecret(blob, "u1:france_travail", KEY)).toEqual({ clientSecret: "s3cr3t" });
    expect(() => decryptSecret(blob, "u2:france_travail", KEY)).toThrow();
    expect(() => encryptSecret({ a: "b" }, "x", {})).toThrow(/JOBPILOT_SECRETS_KEY/);
  });
});

describe("France Travail", () => {
  it("normalise une offre avec ses faits et l'URL du partenaire pour le dédoublonnage", () => {
    const o = normalizeFranceTravail({
      id: "198ABCD",
      intitule: "Data Engineer (H/F)",
      description: "Vous concevez des pipelines de données en Python et SQL pour nos clients industriels, au sein d'une équipe de 8 personnes.",
      dateCreation: "2026-10-17T09:00:00.000Z",
      lieuTravail: { libelle: "69 - LYON 03" },
      entreprise: { nom: "Nordwave" },
      typeContratLibelle: "Contrat à durée indéterminée",
      salaire: { libelle: "Annuel de 45000 Euros à 55000 Euros" },
      competences: [{ libelle: "Python", exigence: "E" }],
      origineOffre: { urlOrigine: "https://www.hellowork.com/fr-fr/emplois/123456.html", partenaires: [{ url: "https://nordwave.example/jobs/1" }] },
    })!;
    expect(o).toMatchObject({
      origin: "france_travail",
      externalId: "198ABCD",
      url: "https://candidat.francetravail.fr/offres/recherche/detail/198ABCD",
      relatedUrls: ["https://www.hellowork.com/fr-fr/emplois/123456.html", "https://nordwave.example/jobs/1"],
      company: "Nordwave",
      location: "Lyon 03 (69)",
      complete: true,
    });
    expect(o.text).toContain("Salaire : Annuel de 45000 Euros à 55000 Euros");
    expect(o.text).toContain("Compétences : Python (exigée)");
    expect(normalizeFranceTravail({ id: "x" })).toBeNull();
  });

  it("traduit les critères : mots-clés, département ou commune, contrats, fraîcheur", async () => {
    const p = await searchParams({ keywords: "data engineer, python", location: "Rhône", radiusKm: 20, contracts: ["CDI", "ALT"], publishedWithinDays: 5, limit: 150 }, async () => null);
    expect(Object.fromEntries(p)).toEqual({ sort: "1", motsCles: "data engineer,python", departement: "69", typeContrat: "CDI", natureContrat: "E2,FS", publieeDepuis: "7" });
    const city = await searchParams({ ...query, location: "Lyon", radiusKm: 10 }, async (name) => (name === "Lyon" ? "69123" : null));
    expect(city.get("commune")).toBe("69123");
    expect(city.get("distance")).toBe("10");
    await expect(searchParams({ ...query, location: "Atlantide" }, async () => null)).rejects.toThrow(/ne connaît pas le lieu/);
    expect(departementCode("rhone")).toBe("69");
    expect(departementCode("2a")).toBe("2A");
  });
});

describe("Adzuna et pages carrières", () => {
  it("Adzuna : extrait à compléter, salaire prédit écarté", () => {
    const o = normalizeAdzuna({ id: 42, title: "<strong>Data</strong> Engineer", description: "Pipelines <strong>Python</strong>…", redirect_url: "https://www.adzuna.fr/land/ad/42", company: { display_name: "Nordwave" }, location: { display_name: "Lyon, Rhône" }, salary_min: 40000, salary_is_predicted: "1", contract_type: "permanent" })!;
    expect(o).toMatchObject({ origin: "adzuna", externalId: "42", title: "Data Engineer", complete: false });
    expect(o.text).toBe("Pipelines Python…\nContrat : CDI");
  });

  it("reconnaît les pages carrières et normalise Greenhouse (HTML échappé) et Lever", () => {
    expect(detectCareerPage("https://job-boards.greenhouse.io/nordwave")).toEqual({ provider: "greenhouse", token: "nordwave" });
    expect(detectCareerPage("jobs.eu.lever.co/nordwave/abc")).toEqual({ provider: "lever", token: "nordwave", region: "eu" });
    expect(detectCareerPage("https://nordwave.recruitee.com/o/data")).toEqual({ provider: "recruitee", token: "nordwave" });
    expect(detectCareerPage("https://jobs.ashbyhq.com/nordwave")).toEqual({ provider: "ashby", token: "nordwave" });
    expect(detectCareerPage("https://careers.smartrecruiters.com/Nordwave")).toEqual({ provider: "smartrecruiters", token: "Nordwave" });
    expect(detectCareerPage("https://www.nordwave.fr/carrieres")).toBeNull();
    expect(careerPageUrl({ provider: "lever", token: "nordwave", region: "eu" })).toBe("https://jobs.eu.lever.co/nordwave");

    const gh = normalizeGreenhouse(
      { id: 7, title: "Data Engineer", absolute_url: "https://job-boards.greenhouse.io/nordwave/jobs/7", location: { name: "Lyon" }, updated_at: "2026-10-15T10:00:00Z", content: "&lt;p&gt;Pipelines &lt;strong&gt;Python&lt;/strong&gt; et SQL pour l&#39;industrie, équipe de huit personnes, déploiement sur GCP.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Airflow&lt;/li&gt;&lt;/ul&gt;" },
      "Nordwave",
    )!;
    expect(gh.text).toContain("Pipelines Python et SQL pour l'industrie");
    expect(gh.text).toContain("- Airflow");
    expect(gh).toMatchObject({ board: "greenhouse", externalId: "7", company: "Nordwave", complete: true });

    const lever = normalizeLever({ id: "ab-1", text: "Data Engineer", hostedUrl: "https://jobs.lever.co/nordwave/ab-1", categories: { location: "Lyon", commitment: "CDI" }, descriptionPlain: "Construire la plateforme de données.", lists: [{ text: "Profil", content: "<li>Python</li><li>SQL</li>" }], createdAt: 1792300000000 }, "Nordwave")!;
    expect(lever.text).toContain("Profil\n- Python\n- SQL");
    expect(lever.text).toContain("Contrat : CDI");
    expect(matchesQuery(lever, { ...query, keywords: "python" })).toBe(true);
    expect(matchesQuery(lever, { ...query, keywords: "rust, scala" })).toBe(false);
    expect(matchesQuery(lever, { ...query, keywords: "python", location: "Paris" })).toBe(false);
  });
});

describe("alertes e-mail", () => {
  it("reconnaît l'expéditeur et les liens d'offre de chaque jobboard", () => {
    expect(boardForSender("jobs-noreply@linkedin.com")?.id).toBe("linkedin");
    expect(boardForSender("alert@match.indeed.com")?.id).toBe("indeed");
    expect(boardForSender("hello@welcometothejungle.com")?.id).toBe("wttj");
    expect(boardForSender("ami@exemple.fr")).toBeNull();
    const cases: [string, string, string][] = [
      ["linkedin", "https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc", "https://www.linkedin.com/jobs/view/4012345678"],
      ["indeed", "https://fr.indeed.com/rc/clk/dl?jk=0123456789abcdef&from=ja", "https://fr.indeed.com/viewjob?jk=0123456789abcdef"],
      ["wttj", "https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon?utm_source=alert", "https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon"],
      ["hellowork", "https://www.hellowork.com/fr-fr/emplois/58123456.html?utm=x", "https://www.hellowork.com/fr-fr/emplois/58123456.html"],
      ["cadremploi", "https://www.cadremploi.fr/emploi/detail_offre?offreId=158712345&xtor=EPR", "https://www.cadremploi.fr/emploi/detail_offre?offreId=158712345"],
      ["meteojob", "https://www.meteojob.com/candidat/offres/offre-d-emploi-data-engineer-h-f-lyon-auvergne-rhone-alpes-cdi-31234567.html", "https://www.meteojob.com/candidat/offres/offre-d-emploi-data-engineer-h-f-lyon-auvergne-rhone-alpes-cdi-31234567.html"],
      ["jobteaser", "https://www.jobteaser.com/fr/job-offers/2f1c3a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b-nordwave-data-engineer", "https://www.jobteaser.com/fr/job-offers/2f1c3a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b"],
      ["apec", "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W?utm_medium=mail", "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/176543210W"],
      ["france_travail", "https://candidat.francetravail.fr/offres/recherche/detail/198ABCD", "https://candidat.francetravail.fr/offres/recherche/detail/198ABCD"],
    ];
    for (const [id, href, url] of cases) expect(matchOffer(board(id), href)?.url, id).toBe(url);
  });

  it("extrait intitulé, entreprise et lieu d'une alerte HTML, regroupe les liens d'une même offre et résout les redirections de suivi", async () => {
    const html = `
      <table>
        <tr><td><a href="https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon"><img alt="Nordwave"></a></td>
            <td><a href="https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon?utm_source=alert">Data Engineer</a><br>Nordwave<br>Lyon</td></tr>
        <tr><td><a href="https://click.welcometothejungle.com/ls/click?upn=abc">Analytics Engineer</a><br>Lumio<br>Paris</td></tr>
        <tr><td><a href="https://click.welcometothejungle.com/ls/click?upn=unsub">Se désabonner</a></td></tr>
      </table>`;
    const resolved: string[] = [];
    const offers = await extractOffers(board("wttj"), { from: "alerts@welcometothejungle.com", date: new Date("2026-10-18T07:00:00Z"), html, text: null }, async (u) => {
      resolved.push(u);
      return "https://www.welcometothejungle.com/fr/companies/lumio/jobs/analytics-engineer_paris";
    });
    expect(resolved).toEqual(["https://click.welcometothejungle.com/ls/click?upn=abc"]);
    expect(offers.map((o) => [o.externalId, o.title, o.company, o.location])).toEqual([
      ["nordwave/data-engineer_lyon", "Data Engineer", "Nordwave", "Lyon"],
      ["lumio/analytics-engineer_paris", "Analytics Engineer", "Lumio", "Paris"],
    ]);
    expect(offers[0]).toMatchObject({ origin: "email_alert", board: "wttj", complete: false, url: "https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon" });
  });

  it("lit une alerte en texte brut et trouve une adresse cachée dans un lien de suivi, sans appel réseau", async () => {
    const text = "Nouvelles offres pour vous\n\nData Engineer\nNordwave - Lyon (69)\nhttps://u123.ct.sendgrid.net/ls/click?url=https%3A%2F%2Fwww.hellowork.com%2Ffr-fr%2Femplois%2F58123456.html\n";
    const offers = await extractOffers(board("hellowork"), { from: "alerte@hellowork.com", date: null, html: null, text }, async () => {
      throw new Error("aucun appel attendu");
    });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ externalId: "58123456", title: "Data Engineer", company: "Nordwave", location: "Lyon (69)" });
  });
});

describe("dédoublonnage entre sources", () => {
  it("rapproche une même annonce par URL partenaire ou par intitulé, entreprise et ville, et garde le texte complet", () => {
    expect(dedupKey("Data Engineer (H/F)", "Nordwave SAS", "Lyon 03 (69)")).toBe(dedupKey("Data Engineer H/F", "nordwave", "LYON 03"));
    expect(dedupKey("Data Engineer", null, "Lyon")).toBeNull();
    const base = { origin: "adzuna" as const, publishedAt: new Date("2026-10-17"), relatedUrls: [] };
    const merged = mergeResults([
      { ...base, board: "adzuna", externalId: "1", url: "https://www.adzuna.fr/land/ad/1", title: "Data Engineer (H/F)", company: "Nordwave", location: "Lyon", text: "extrait", complete: false },
      { ...base, origin: "france_travail", board: "france_travail", externalId: "FT1", url: "https://candidat.francetravail.fr/offres/recherche/detail/FT1", relatedUrls: ["https://www.hellowork.com/fr-fr/emplois/9.html"], title: "Data Engineer H/F", company: "Nordwave", location: "Lyon", text: "texte complet", complete: true },
      { ...base, board: "greenhouse", origin: "career_page", externalId: "7", url: "https://www.hellowork.com/fr-fr/emplois/9.html", title: "Ingénieur données", company: "Autre", location: "Lyon", text: "x", complete: true },
      { ...base, board: "adzuna", externalId: "2", url: "https://www.adzuna.fr/land/ad/2", title: "Product Owner", company: "Lumio", location: "Paris", text: "y", complete: false },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.boards).toEqual(["france_travail", "adzuna", "greenhouse"]);
    expect(merged[0]!.others.map((o) => o.board)).toEqual(["adzuna", "greenhouse"]);
    expect(merged[0]!.offer).toMatchObject({ board: "france_travail", complete: true });
  });
});
