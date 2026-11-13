import { test } from "./isolation";
import { catalogueFicheScenarios } from "./ui-catalogue-fiche.shared";

for (const [title, run] of catalogueFicheScenarios()) test(title, run);
