import { describe, expect, it } from "vitest";
import { fetchJobPage } from "@/modules/offers/fetch/safe-fetch";
import { cityOf, dedupKey } from "@/modules/offers/ingest";
import { decryptSecret, encryptSecret } from "@/modules/platform/secrets";
import { normalizeAdzuna } from "@/modules/sources/connectors/adzuna";
import { careerPageUrl, detectCareerPage, locationMatches, matchesQuery, normalizeGreenhouse, normalizeLever } from "@/modules/sources/connectors/career-pages";
import { departementCode, departementOfPostalCode } from "@/modules/sources/connectors/departements";
import { normalizeFranceTravail, searchParams, type Places } from "@/modules/sources/connectors/france-travail";
import { keywordGroups, searchEachGroup } from "@/modules/sources/connectors/keywords";
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

  it("traduit les critères : mots-clés, département, commune ou code postal, contrats, fraîcheur", async () => {
    const none: Places = { byName: async () => null, byPostalCode: async () => null, isCommuneCode: async () => false };
    const p = await searchParams({ keywords: "data engineer", location: "Rhône", radiusKm: 20, contracts: ["CDI", "ALT"], publishedWithinDays: 5, limit: 150 }, none);
    expect(Object.fromEntries(p)).toEqual({ sort: "1", motsCles: "data,engineer", departement: "69", typeContrat: "CDI", natureContrat: "E2,FS", publieeDepuis: "7" });
    const city = await searchParams({ ...query, location: "Lyon", radiusKm: 10 }, { ...none, byName: async (name) => (name === "Lyon" ? "69123" : null) });
    expect(city.get("commune")).toBe("69123");
    expect(city.get("distance")).toBe("10");
    await expect(searchParams({ ...query, location: "Atlantide" }, none)).rejects.toThrow(/ne connaît pas le lieu/);
    // Un code postal n'est jamais pris pour un code INSEE : 13001 (Marseille 1er) n'est pas Aix-en-Provence (INSEE 13001).
    const postal = await searchParams({ ...query, location: "13001" }, { ...none, byPostalCode: async (cp) => (cp === "13001" ? "13201" : null), isCommuneCode: async () => true });
    expect(postal.get("commune")).toBe("13201");
    const unknownPostal = await searchParams({ ...query, location: "75011" }, none);
    expect([unknownPostal.get("commune"), unknownPostal.get("departement")]).toEqual([null, "75"]);
    expect(departementCode("rhone")).toBe("69");
    expect(departementCode("2a")).toBe("2A");
    expect([departementOfPostalCode("97400"), departementOfPostalCode("20090"), departementOfPostalCode("20200")]).toEqual(["974", "2A", "2B"]);
  });

  it("cherche chaque variante séparément et réunit les résultats (« ou »)", async () => {
    const calls: [string, number][] = [];
    const res = await searchEachGroup({ ...query, keywords: "data engineer, ingénieur données,  data engineer ", limit: 10 }, async (keywords, limit) => {
      calls.push([keywords, limit]);
      const offer = (id: string) => ({ origin: "adzuna" as const, board: "adzuna", externalId: id, url: null, title: id, company: null, location: null, publishedAt: null, text: id, complete: false });
      return { offers: keywords === "data engineer" ? [offer("a"), offer("b")] : [offer("b"), offer("c")], total: 2 };
    });
    expect(calls).toEqual([["data engineer", 5], ["ingénieur données", 5]]);
    expect(res.offers.map((o) => o.externalId)).toEqual(["a", "b", "c"]);
    expect(keywordGroups("a, bi, cc, dd, ee, ff, gg")).toEqual(["bi", "cc", "dd", "ee", "ff"]);
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

describe("défauts corrigés (relecture du 19/10/2026)", () => {
  const base = { origin: "france_travail" as const, board: "france_travail", publishedAt: new Date("2026-10-17"), relatedUrls: [], text: "x", complete: true };

  it("garde distinctes les villes à tiret et rapproche les écritures d'une même ville", () => {
    expect(cityOf("Saint-Denis")).not.toBe(cityOf("Saint-Malo"));
    expect(dedupKey("Ingénieur DevOps H/F", "Orange", "Saint-Denis")).not.toBe(dedupKey("Ingénieur DevOps H/F", "Orange", "Saint-Malo"));
    expect(cityOf("Aix-en-Provence")).toBe("aix en provence");
    expect(cityOf("Saint-Étienne (42)")).toBe(cityOf("Saint Etienne"));
    expect(["Lyon 03 (69)", "69003 Lyon", "Lyon, France", "Lyon 3e", "LYON"].map(cityOf)).toEqual(["lyon", "lyon", "lyon", "lyon", "lyon"]);
    expect(cityOf("Nordwave - Lyon")).toBe("nordwave");
    expect(dedupKey("Ingénieur données", "Nordwave", "Lyon")).toBe(dedupKey("Ingenieur donnees", "Nordwave", "LYON 03 (69)"));
  });

  it("ne fusionne pas deux annonces d'un même site aux identifiants différents (intérim, postes multiples)", () => {
    const offer = (externalId: string, board = "france_travail") => ({ ...base, board, externalId, url: `https://exemple.fr/${board}/${externalId}`, title: "Préparateur de commandes H/F", company: "Adecco", location: "Lyon" });
    const merged = mergeResults([offer("M1"), offer("M2"), offer("A9", "adzuna")]);
    expect(merged.map((m) => m.boards.join("+"))).toEqual(["france_travail+adzuna", "france_travail"]);
  });

  it("filtre une page carrières par ville, code postal ou département (nom, code, préfecture)", () => {
    expect(locationMatches("Lyon, France", "Lyon")).toBe(true);
    expect(locationMatches("Lyon, France", "69")).toBe(true);
    expect(locationMatches("Lyon, France", "Rhône")).toBe(true);
    expect(locationMatches("Lyon 3e", "69003")).toBe(true);
    expect(locationMatches("Paris", "69")).toBe(false);
    expect(locationMatches("Varces", "Var")).toBe(false);
    expect(locationMatches("Toulon", "Var")).toBe(true);
    expect(locationMatches("Villeurbanne (69)", "Rhône")).toBe(true);
  });

  it("ne suit aucun lien d'une alerte LinkedIn ou Indeed, même un lien court lnkd.in", async () => {
    const html = `<a href="https://lnkd.in/abc123">Data Engineer</a><br>Nordwave<br>Lyon
      <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=x">Analytics Engineer</a><br>Lumio<br>Paris`;
    const offers = await extractOffers(board("linkedin"), { from: "jobs-noreply@linkedin.com", date: null, html, text: null }, async () => {
      throw new Error("aucun appel attendu");
    });
    expect(offers.map((o) => o.externalId)).toEqual(["4012345678"]);
    const indeed = await extractOffers(board("indeed"), { from: "alert@indeed.com", date: null, html: `<a href="https://cts.indeed.com/v3/abc">Data Engineer</a>`, text: null }, async () => {
      throw new Error("aucun appel attendu");
    });
    expect(indeed).toEqual([]);
    // Le raccourcisseur de LinkedIn est un domaine exclu comme linkedin.com : jamais contacté.
    await expect(fetchJobPage("https://lnkd.in/abc123")).rejects.toMatchObject({ reason: "blocked_domain" });
  });
});
