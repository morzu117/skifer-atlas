import logo from "../assets/logo.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand brand-compact" : "brand"}>
      <img src={logo} alt="" className="brand-logo" />
      <div className="brand-text">
        <span className="brand-name">Skifer</span>
        <span className="brand-sub">Atlas</span>
      </div>
    </div>
  );
}
