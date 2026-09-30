import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CreditCard,
  Database,
  FolderKanban,
  Layers3,
  MessageCircle,
  Package,
  Settings2,
  UsersRound,
} from "lucide-react";
import { getPublishedProductIdentities } from "@/lib/product-identity-server";

export const metadata: Metadata = {
  title: { absolute: "Display SH — uma plataforma, vários negócios" },
  description:
    "Um ecossistema de sistemas de gestão feito para diferentes negócios de serviços.",
  applicationName: "Display SH",
  manifest: "/display-sh/manifest.webmanifest",
  icons: { icon: "/display-sh/icon.svg", apple: "/display-sh/icon.svg" },
  appleWebApp: { capable: true, title: "Display SH", statusBarStyle: "black-translucent" },
};

const products = [
  {
    slug: "los-barberos",
    name: "Los Barberos",
    audience: "Barbearias",
    state: "Disponível",
    image: "/display-sh/los-barberos.png",
    alt: "Logomarca Los Barberos — barbearias",
    className: "ecosystem-product--barbers",
    available: true,
  },
  {
    slug: "pro-stetic",
    name: "ProStetic",
    audience: "Estética e beleza",
    state: "Disponível",
    image: "/display-sh/pro-stetic-transparent.png",
    alt: "Logomarca ProStetic — estética e beleza",
    className: "ecosystem-product--pro-stetic",
    available: true,
  },
  {
    slug: "le-gras",
    name: "Le Gras",
    audience: "Estúdios fotográficos",
    state: "Próximo lançamento",
    image: "/display-sh/le-gras.png",
    alt: "Logomarca Le Gras — fotografia",
    className: "ecosystem-product--le-gras",
    available: true,
  },
  {
    slug: "music-pro",
    name: "MusicPro",
    audience: "Escolas de música",
    state: "Em breve",
    image: "/music-pro/logo-neon.png",
    alt: "Logomarca MusicPro — escolas de música",
    className: "ecosystem-product--music-pro",
    available: false,
  },
];

const sharedServices = [
  { icon: UsersRound, label: "Identidade e acesso" },
  { icon: Database, label: "Dados por organização" },
  { icon: CreditCard, label: "Pagamentos" },
  { icon: Settings2, label: "Integrações" },
  { icon: ChartNoAxesColumnIncreasing, label: "Relatórios gerenciais" },
];

const modules = [
  { icon: CalendarDays, label: "Agenda" },
  { icon: UsersRound, label: "Clientes" },
  { icon: CreditCard, label: "Financeiro" },
  { icon: FolderKanban, label: "Projetos", optional: true },
  { icon: Package, label: "Estoque" },
  { icon: MessageCircle, label: "Comunicação" },
  { icon: ChartNoAxesColumnIncreasing, label: "Relatórios gerenciais" },
];

export default async function DisplayHomePage() {
  const identities = await getPublishedProductIdentities();
  const productCards = products.map((product) => {
    const identity = identities[product.slug];
    return identity ? { ...product, name: identity.brand.name, image: identity.brand.logoUrl || product.image, alt: `Logomarca ${identity.brand.name}` } : product;
  });
  return (
    <div className="ecosystem-page">
      <header className="ecosystem-header">
        <div className="ecosystem-wrap ecosystem-header__inner">
          <Link href="/" className="ecosystem-brand" aria-label="Display SH — início">
            <Image src="/display-sh/wordmark.png" alt="Display SH — negócios mais fortes juntos" width={255} height={80} priority />
          </Link>
          <nav aria-label="Navegação principal" className="ecosystem-nav">
            <a href="#produtos">Produtos</a>
            <a href="#plataforma">Plataforma</a>
            <a href="#modulos">Módulos</a>
          </nav>
          <a className="ecosystem-contact" href="mailto:contato@displaysh.com">
            Fale com a gente <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main>
        <section className="ecosystem-hero">
          <div className="ecosystem-wrap ecosystem-hero__inner">
            <div className="ecosystem-hero__copy">
              <p className="ecosystem-overline">UM ECOSSISTEMA FEITO PARA SERVIÇOS</p>
              <h1>Uma plataforma.<br /><em>Vários negócios.</em></h1>
              <p className="ecosystem-hero__lead">Sistemas pensados para a realidade de cada negócio, com uma base compartilhada e módulos que acompanham a sua operação.</p>
              <a href="#produtos" className="ecosystem-primary-link">Encontre seu sistema <ArrowDown size={17} aria-hidden="true" /></a>
            </div>
            <div className="ecosystem-hero__seal" aria-label="Display SH, negócios mais fortes juntos">
              <span>MAIS NEGÓCIOS</span><i /><span>PARA MAIS PESSOAS</span>
            </div>
          </div>
        </section>

        <section className="ecosystem-products" id="produtos" aria-labelledby="ecosystem-products-title">
          <div className="ecosystem-wrap">
            <div className="ecosystem-section-heading">
              <h2 id="ecosystem-products-title">Um sistema para cada jeito de trabalhar.</h2>
              <p>Escolha uma marca para conhecer a solução feita para o seu segmento.</p>
            </div>
            <div className="ecosystem-product-grid">
              {productCards.map((product) => (
                <Link
                  href={`/${product.slug}`}
                  key={product.slug}
                  className={`ecosystem-product ${product.className}`}
                  aria-label={`${product.name} — ${product.audience}. ${product.state}.`}
                >
                  <span className="ecosystem-product__image"><Image src={product.image} alt={product.alt} width={400} height={114} /></span>
                  <span className="ecosystem-product__meta"><strong>{product.audience}</strong><span>{product.state}{product.available && <ArrowRight size={15} aria-hidden="true" />}</span></span>
                </Link>
              ))}
            </div>
            <p className="ecosystem-products__note">Novas soluções entram no ecossistema de forma gradual.</p>
          </div>
        </section>

        <section className="ecosystem-platform" id="plataforma" aria-labelledby="ecosystem-platform-title">
          <div className="ecosystem-wrap">
            <div className="ecosystem-platform__bar">
              <Layers3 size={43} strokeWidth={1.4} aria-hidden="true" />
              <div><h2 id="ecosystem-platform-title">DISPLAY SH</h2><span>PLATAFORMA COMPARTILHADA</span></div>
              <p>Uma base sólida<br />para diferentes negócios</p>
            </div>
            <div className="ecosystem-services" aria-label="Serviços compartilhados">
              <h3>Serviços compartilhados</h3>
              {sharedServices.map(({ icon: Icon, label }) => <div className="ecosystem-service" key={label}><Icon size={28} strokeWidth={1.55} aria-hidden="true" /><span>{label}</span></div>)}
            </div>
            <div className="ecosystem-modules" id="modulos">
              <div className="ecosystem-modules__label"><h3>Módulos</h3><span>sob medida</span></div>
              <div className="ecosystem-modules__list">
                {modules.map(({ icon: Icon, label, optional }) => (
                  <div className={`ecosystem-module${optional ? " ecosystem-module--optional" : ""}`} key={label}>
                    <Icon size={25} strokeWidth={1.65} aria-hidden="true" />
                    <span>{label}</span>
                    {optional && <small>opcional</small>}
                  </div>
                ))}
              </div>
              <p className="ecosystem-modules__caption">Cada organização escolhe os módulos que fazem sentido para sua rotina.</p>
            </div>
          </div>
        </section>

        <section className="ecosystem-roadmap" aria-labelledby="ecosystem-roadmap-title">
          <div className="ecosystem-wrap ecosystem-roadmap__inner">
            <div className="ecosystem-roadmap__intro"><p className="ecosystem-overline">CRESCIMENTO GRADUAL</p><h2 id="ecosystem-roadmap-title">Uma etapa de cada vez.</h2><p>Ampliamos o ecossistema conforme cada solução fica pronta para atender seu mercado.</p></div>
            <ol className="ecosystem-roadmap__list">
              <li className="is-live"><span>1</span><div><strong>Los Barberos</strong><small>Barbearias</small></div><b>Disponível</b></li>
              <li className="is-live"><span>2</span><div><strong>ProStetic</strong><small>Estética e beleza</small></div><b>Disponível</b></li>
              <li><span>3</span><div><strong>Le Gras</strong><small>Fotografia</small></div><b>Próximo</b></li>
            </ol>
          </div>
        </section>

        <section className="ecosystem-future">
          <div className="ecosystem-wrap ecosystem-future__inner">
            <div><p className="ecosystem-overline">O ECOSSISTEMA CONTINUA</p><h2>Mais possibilidades, no tempo certo.</h2><p>Descoberta local, conexões B2C e B2B, cashback, emissão de nota fiscal e relatórios contábeis fazem parte dos próximos horizontes.</p></div>
            <Link href="/los-barberos" className="ecosystem-future__link">Conhecer Los Barberos <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="ecosystem-footer">
        <div className="ecosystem-wrap ecosystem-footer__inner">
          <Image src="/display-sh/wordmark.png" alt="Display SH" width={205} height={64} />
          <p>Negócios mais fortes juntos.</p>
          <span>© 2026 Display SH · Tecnologia que impulsiona pessoas e negócios</span>
        </div>
      </footer>
    </div>
  );
}
