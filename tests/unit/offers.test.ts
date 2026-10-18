import { describe, expect, it } from "vitest";
import { extractJobPage } from "@/modules/offers/fetch/html";
import { isPublicAddress } from "@/modules/offers/fetch/safe-fetch";
import { extractFileText } from "@/modules/offers/files";
import { canonicalUrl, cleanText, contentHash, normalizeCompanyName, provisionalTitle } from "@/modules/offers/normalize";
import { minimalPdf } from "../helpers/pdf";

describe("URL canonique", () => {
  it.each([
    ["https://www.Exemple.fr/jobs/123/?utm_source=x&utm_medium=y#apply", "https://exemple.fr/jobs/123"],
    ["http://exemple.fr:80/jobs/123", "https://exemple.fr/jobs/123"],
    ["https://exemple.fr/job?b=2&a=1&gclid=zz", "https://exemple.fr/job?a=1&b=2"],
    ["https://exemple.fr/viewjob?jk=abc&from=alert", "https://exemple.fr/viewjob?jk=abc"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected);
  });

  it("refuse ce qui n'est pas une URL web", () => {
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalUrl("pas une url")).toBeNull();
    expect(canonicalUrl("ftp://exemple.fr/a")).toBeNull();
  });
});

describe("empreinte du texte", () => {
  it("ignore casse, espaces et ponctuation de mise en forme", () => {
    const a = "Senior Data Engineer\n\nMissions : concevoir des pipelines.";
    const b = "  senior   data engineer — MISSIONS concevoir des pipelines  ";
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("distingue deux annonces au contenu différent", () => {
    expect(contentHash("Data Engineer Lyon")).not.toBe(contentHash("Data Engineer Paris"));
  });

  it("nettoie le texte sans en perdre les paragraphes", () => {
    expect(cleanText("Titre\r\n\r\n\r\n\r\nLigne  1\t\tsuite\u0007")).toBe("Titre\n\nLigne 1 suite");
  });

  it("titre provisoire et nom d'entreprise normalisé", () => {
    expect(provisionalTitle("\n\n  Senior Data Engineer  \nLyon")).toBe("Senior Data Engineer");
    expect(provisionalTitle("x".repeat(200))).toHaveLength(118);
    expect(normalizeCompanyName("Nordwave SAS")).toBe(normalizeCompanyName("NORDWAVE"));
  });
});

describe("extraction d'une page d'annonce", () => {
  it("privilégie l'annonce structurée JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ignorée" },
        {
          "@type": "JobPosting",
          title: "Senior Data Engineer",
          description: "<p>Vos missions :</p><ul><li>Pipelines Airflow</li><li>BigQuery</li></ul>",
          datePosted: "2026-10-15",
          hiringOrganization: { "@type": "Organization", name: "Nordwave" },
          jobLocation: { "@type": "Place", address: { addressLocality: "Lyon" } },
        },
      ],
    })}</script></head><body><h1>Autre titre</h1></body></html>`;
    const page = extractJobPage(html);
    expect(page).toMatchObject({ method: "json-ld", title: "Senior Data Engineer", company: "Nordwave", location: "Lyon" });
    expect(page.publishedAt?.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(page.text).toContain("Pipelines Airflow");
    expect(page.text).not.toContain("<li>");
  });

  it("à défaut, garde le contenu principal sans scripts ni navigation", () => {
    const html = `<html><head><title>Offre | Site</title><script>alert("x")</script></head>
      <body><nav>Accueil Connexion</nav><main><h1>Analytics Engineer</h1><p>Rejoignez notre équipe data.</p></main><footer>Mentions</footer></body></html>`;
    const page = extractJobPage(html);
    expect(page.method).toBe("html");
    expect(page.title).toBe("Analytics Engineer");
    expect(page.text).toContain("Rejoignez notre équipe data.");
    expect(page.text).not.toMatch(/alert|Accueil|Mentions/);
  });

  it("ignore un JSON-LD invalide", () => {
    const page = extractJobPage(`<script type="application/ld+json">{invalide</script><main>Texte</main>`);
    expect(page.method).toBe("html");
  });
});

describe("adresses joignables", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"])(
    "%s est refusée",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );
  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("%s est acceptée", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("fichiers importés", () => {
  it("extrait le texte d'un PDF, type déduit du contenu", async () => {
    const pdf = minimalPdf(["Senior Data Engineer chez Nordwave", "Missions : pipelines Airflow et BigQuery sur GCP."]);
    const file = await extractFileText(pdf);
    expect(file.kind).toBe("pdf");
    expect(file.text).toContain("Senior Data Engineer");
  });

  it("accepte un fichier texte et refuse un binaire", async () => {
    const txt = Buffer.from("Analytics Engineer à Nantes. ".repeat(5));
    expect((await extractFileText(txt)).kind).toBe("txt");
    await expect(extractFileText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))).rejects.toMatchObject({ reason: "unsupported_type" });
  });

  it("refuse un fichier trop gros ou sans texte", async () => {
    await expect(extractFileText(Buffer.alloc(10 * 1024 * 1024 + 1, 97))).rejects.toMatchObject({ reason: "too_large" });
    await expect(extractFileText(Buffer.from("court"))).rejects.toMatchObject({ reason: "empty" });
  });
});
