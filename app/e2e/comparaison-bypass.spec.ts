import { expect } from "@playwright/test";
import { AUTH_API, git, isolatedDemo, python, relay, test } from "./isolation";

// Jointure à contrôle de cardinalité contourné : signalée à l'écran avant tout lancement
// (plans 0009 et 0015). La démonstration n'en a pas : le scénario en pose une dans le KPI
// canonique d'un espace isolé (n07, la jointure de la date comptable).
test("[S-0009-05] [S-0015-03] Une jointure contournée est signalée avant le lancement, et suit la granularité et la tolérance choisies", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'kpis/revenu-net.yaml'
d=yaml.safe_load(p.read_text())
join=next(n for n in d['graph']['nodes'] if n['id']=='n07')
join['check']='bypass'; join['bypass_reason']='Calendrier à une date par jour : la jointure ne multiplie pas les lignes.'
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Jointure n07 à contrôle contourné");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);

  const starts: unknown[] = [];
  const previews: { variants: string[]; scope_id?: string; scope?: { period: { from: string; to: string }; granularity: string[] }; tolerance?: number }[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (r.url().endsWith(`/api/workspaces/${ws.id}/comparisons`)) starts.push(r.postDataJSON());
    if (r.url().endsWith("/comparisons/preview")) previews.push(r.postDataJSON());
  });

  await page.goto(`${ws.root}/comparaison`);
  // Alerte au chargement, sans rien lancer : une par déclinaison concernée, avec le nœud.
  const banner = page.getByText("nordis-fr : contrôle de cardinalité contourné (n07).");
  await expect(banner).toBeVisible();
  await expect(page.getByText("Contrôle de cardinalité contourné", { exact: true }).first()).toBeVisible();
  expect(previews[0]).toMatchObject({ scope_id: "fy2026-mois-entite" });
  expect(previews[0].variants).toContain("nordis-fr");
  expect(starts).toEqual([]);

  // Granularité plus grossière et tolérance choisie : un scope ad hoc, et l'alerte reste.
  const granularity = page.getByRole("combobox", { name: "Granularité" });
  await granularity.selectOption({ label: "Mois fiscal" });
  await page.getByRole("slider", { name: /Tolérance/ }).fill("2");
  await expect(page.getByText("Tolérance : 2 %")).toBeVisible();
  await expect.poll(() => previews.at(-1)?.scope?.granularity).toEqual(["mois_fiscal"]);
  await expect.poll(() => previews.at(-1)?.tolerance).toBe(2);
  expect(previews.at(-1)?.scope_id).toBeUndefined();
  await expect(banner).toBeVisible();
  expect(starts).toEqual([]);
});
