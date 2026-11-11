import { expect, type Locator } from "@playwright/test";

/** Résout l'index dans l'en-tête, puis cible la cellule correspondante, y compris les th de ligne. */
export async function cellByColumn(row: Locator, table: Locator, name: string): Promise<Locator> {
  const headers = table.getByRole("columnheader");
  const header = headers.filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  await expect(header).toHaveCount(1);
  const index = await header.evaluate((element) => Array.from(element.parentElement!.children).indexOf(element));
  return row.locator(":scope > th, :scope > td").nth(index);
}
