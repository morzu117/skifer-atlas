import type { ReactNode } from "react";

/** Conteneur de tableau défilant au clavier, nommé selon son contenu. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-wrap" role="group" aria-label={label} tabIndex={0}>{children}</div>;
}
