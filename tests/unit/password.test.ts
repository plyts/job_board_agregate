import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/modules/identity/password";
import { safeNextPath } from "@/lib/auth/cookie";

describe("mots de passe", () => {
  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$65536$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterie", hash)).toBe(false);
  });

  it("produit un sel différent à chaque hachage", async () => {
    expect(await hashPassword("même mot de passe")).not.toBe(await hashPassword("même mot de passe"));
  });

  it("refuse un format d'empreinte inconnu", async () => {
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/offres?x=1", "/offres?x=1"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    [undefined, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
