import Link from "next/link";

type BrandProps = {
  href?: string;
  compact?: boolean;
  light?: boolean;
};

export function Brand({ href = "/", compact = false, light = false }: BrandProps) {
  return (
    <Link
      href={href}
      className={`brand ${compact ? "brand--compact" : ""} ${light ? "brand--light" : ""}`}
      aria-label="Los Barberos · Início"
    >
      <span className="brand__mark" aria-hidden="true">
        <span>LB</span>
      </span>
      {!compact && (
        <span className="brand__wordmark">
          <strong>Los Barberos</strong>
          <small>gestão para barbearias</small>
        </span>
      )}
    </Link>
  );
}

