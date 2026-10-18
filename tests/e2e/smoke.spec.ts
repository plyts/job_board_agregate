import { expect, test } from "@playwright/test";

test("le service répond au contrôle de santé", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok" });
});
