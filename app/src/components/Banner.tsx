import type { ReactNode } from "react";
import { Icon } from "./Icon";

// Bandeau d'alerte (guide 3.7) : icône, titre, une phrase qui dit quoi faire, une action.
export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: "warn" | "bad" | "info";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "info" ? "status" : "alert"}>
      <Icon name="alert" className="icon-banner" />
      <div className="banner-body">
        <strong>{title}</strong>
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  );
}
