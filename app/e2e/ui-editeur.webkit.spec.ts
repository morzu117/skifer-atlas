import { test } from "./isolation";
import { editorScenarios, openEditor } from "./ui-editeur.shared";

test.beforeEach(openEditor);
for (const [title, run] of editorScenarios()) test(title, run);
