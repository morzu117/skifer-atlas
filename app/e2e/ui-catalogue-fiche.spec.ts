import { test } from "./isolation";
import { catalogueFicheScenarios } from "./ui-catalogue-fiche.shared";

for (const [title, run] of catalogueFicheScenarios()) {
  // tri non spécifié par la maquette 10.1 ni par le plan, à décider
  if (title.startsWith("[S-UI-101-28]")) test.fixme(title, run);
  else test(title, run);
}
