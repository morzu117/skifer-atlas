import { expect, test } from "@playwright/test";
import { AUTH_API, git, isolatedDemo, python, relay } from "./isolation";

test("[S-0022-02] Une source non réassociable nomme avoirs à l'écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'variants/revenu-net/nordis-es.yaml'
d=yaml.safe_load(p.read_text()); source=d['graph']['nodes'][0]
source['columns']=[c for c in source['columns'] if c['name']!='abonos']
del source['binding']['abonos']
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Source ES sans avoirs");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/comparaison`);
  await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeDisabled();
  await expect(page.getByText(/avoirs/).first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /nordis-es/ })).not.toBeChecked();
});

test("[S-0022-03] Le refus nomme les deux types ; un entier est accepté comme décimal", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  for (const kind of ["string", "integer"]) {
    python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'variants/revenu-net/nordis-es.yaml'
d=yaml.safe_load(p.read_text())
next(c for c in d['graph']['nodes'][0]['columns'] if c['name']=='iva')['type']=sys.argv[2]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work, kind);
    git(ws.work, "add", ".");
    git(ws.work, "commit", "-qm", `Type de iva : ${kind}`);
    git(ws.work, "push", "origin", "main");
    expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
    // Même adresse au second tour : seul un rechargement relit l'aperçu après le sync.
    await page.goto(`${ws.root}/comparaison`);
    await page.reload();
    if (kind === "string") {
      await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeDisabled();
      await expect(page.getByText(/montant_taxes \(decimal attendu, string dans iva\)/)).toBeVisible();
    } else {
      await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeEnabled();
      await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeChecked();
    }
  }
});

test("[S-0022-04] La clé commande_id est requise, facture_id non lue peut manquer", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // ES n'a pas de facture_id : sa facture locale est liée à commande_id.
  await page.goto(`${ws.root}/comparaison`);
  await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeEnabled();
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'variants/revenu-net/nordis-es.yaml'
d=yaml.safe_load(p.read_text()); source=d['graph']['nodes'][0]
source['columns']=[c for c in source['columns'] if c['name']!='factura_id']
del source['binding']['factura_id']
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Source ES sans clé de concept");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /nordis-es/ })).toBeDisabled();
  await expect(page.getByText(/Non comparable :.*commande_id/)).toBeVisible();
});
