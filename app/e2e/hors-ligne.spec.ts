import { expect, test } from "@playwright/test";
import { ensureNordis } from "./demo";

test("[S-0019-04] Hors ligne : ouvrir l'espace, le catalogue et compiler le graphe", async ({ page, request }) => {
  await ensureNordis(request);
  await page.route("**/*", route => {
    const local = ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname);
    return local ? route.continue() : route.abort();
  });
  await page.goto("/");
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Groupe Nordis" }).click();
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true }).click();
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  const bottom = page.getByRole("region", { name: "Validation du document" });
  await bottom.getByRole("tab", { name: "SQL compilé" }).click();
  await expect(bottom.getByLabel("SQL databricks")).toContainText("SELECT");
  await bottom.getByRole("radio", { name: "Snowflake" }).check();
  await expect(bottom.getByLabel("SQL snowflake")).toContainText("SELECT");
});
