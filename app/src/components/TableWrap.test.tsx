import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { TableWrap } from "./TableWrap";

it("nomme le groupe et permet de l'atteindre au clavier", async () => {
  render(<TableWrap label="Exemple de tableau"><table><tbody><tr><td>Valeur</td></tr></tbody></table></TableWrap>);
  const group = screen.getByRole("group", { name: "Exemple de tableau" });
  await userEvent.tab();
  expect(group).toHaveFocus();
});
