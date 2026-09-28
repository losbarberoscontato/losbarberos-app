import Link from "next/link";

type BrandProps = {
  href?: string;
  compact?: boolean;
  light?: boolean;
  name?: string;
  tagline?: string;
  mark?: string;
  logoUrl?: string;
};

export function Brand({ href = "/", compact = false, light = false, name = "Los Barberos", tagline = "gestão para barbearias", mark = "LB", logoUrl }: BrandProps) {
  return (
    <Link
      href={href}
      className={`brand ${compact ? "brand--compact" : ""} ${light ? "brand--light" : ""}`}
      aria-label={`${name} · Início`}
    >
      <span className="brand__mark" aria-hidden="true" style={logoUrl ? { backgroundImage: `url("${logoUrl}")`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundColor: "rgba(255,255,255,.92)" } : undefined}>
        {!logoUrl && <span>{mark}</span>}
      </span>
      {!compact && (
        <span className="brand__wordmark">
          <strong>{name}</strong>
          <small>{tagline}</small>
        </span>
      )}
    </Link>
  );
}

