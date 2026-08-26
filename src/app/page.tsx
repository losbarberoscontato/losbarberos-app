import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  CreditCard,
  MessageCircle,
  Scissors,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/brand";

const featureCards = [
  {
    icon: CalendarCheck2,
    title: "Agenda que trabalha por você",
    text: "Reservas online, encaixes, lembretes e proteção contra horários duplicados.",
    tone: "sage",
  },
  {
    icon: CreditCard,
    title: "Receba sem atrito",
    text: "Sinal ou pagamento completo via Mercado Pago, com conciliação clara por atendimento.",
    tone: "amber",
  },
  {
    icon: Users,
    title: "Clientes que voltam",
    text: "Histórico, preferências e WhatsApp transacional no momento certo.",
    tone: "blue",
  },
  {
    icon: WalletCards,
    title: "Comissões sem planilha",
    text: "Regras por profissional, fechamento por período e um ledger confiável.",
    tone: "rose",
  },
];

export default function HomePage() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-container landing-nav__inner">
          <Brand />
          <nav aria-label="Navegação principal">
            <a href="#produto">Produto</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#preco">Preço</a>
          </nav>
          <div className="landing-nav__actions">
            <Link href="/entrar?modo=login" className="button button--ghost">Entrar</Link>
            <Link href="/entrar?modo=cadastro" className="button button--dark">Começar grátis <ArrowRight size={16} /></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero__grain" />
          <div className="landing-container landing-hero__grid">
            <div className="landing-hero__copy">
              <span className="hero-pill"><Sparkles size={15} /> 14 dias grátis · sem fidelidade</span>
              <h1>Sua barbearia cheia.<br /><em>Sua rotina leve.</em></h1>
              <p>Agenda, clientes, pagamentos e equipe em um sistema que parece feito sob medida para sua barbearia.</p>
              <div className="landing-hero__actions">
                <Link href="/entrar?modo=cadastro" className="button button--accent button--lg">
                  Testar agora <ArrowRight size={18} />
                </Link>
                <Link href="/cliente/agendar" className="button button--hero-ghost button--lg">
                  Ver experiência do cliente
                </Link>
              </div>
              <div className="hero-proof">
                <div className="hero-proof__avatars"><span>DA</span><span>ML</span><span>JV</span><span>+</span></div>
                <div><div className="hero-proof__stars"><Star size={13} fill="currentColor" /><Star size={13} fill="currentColor" /><Star size={13} fill="currentColor" /><Star size={13} fill="currentColor" /><Star size={13} fill="currentColor" /></div><small>Feito com barbeiros, para barbeiros</small></div>
              </div>
            </div>

            <div className="hero-product" aria-label="Prévia do painel Los Barberos">
              <div className="hero-product__glow" />
              <div className="hero-dashboard">
                <aside className="hero-dashboard__rail">
                  <span className="hero-dashboard__logo">LB</span>
                  {["grid", "calendar", "users", "wallet"].map((item, index) => <span key={item} className={index === 0 ? "active" : ""} />)}
                </aside>
                <div className="hero-dashboard__body">
                  <div className="hero-dashboard__top"><span><b>Boa tarde, Guilherme</b><small>Terça-feira, 4 de agosto</small></span><i>GC</i></div>
                  <div className="hero-dashboard__metrics">
                    <div><small>Faturamento hoje</small><strong>R$ 1.845</strong><span>+18% esta semana</span></div>
                    <div><small>Agenda</small><strong>12</strong><span>9 confirmados</span></div>
                    <div><small>Ocupação</small><strong>78%</strong><span>Boa performance</span></div>
                  </div>
                  <div className="hero-dashboard__agenda">
                    <div className="hero-dashboard__section-title"><b>Próximos horários</b><small>Ver agenda</small></div>
                    {[
                      ["09:30", "CN", "Caio Nogueira", "Corte + barba", "Em atendimento"],
                      ["10:45", "BS", "Bruno Salles", "Barba premium", "Confirmado"],
                      ["11:45", "VR", "Vinícius Rocha", "Corte degradê", "Pendente"],
                    ].map(([time, initials, name, service, status], index) => (
                      <div className="hero-dashboard__row" key={time}>
                        <time>{time}</time><i className={`tone-${index}`}>{initials}</i><span><b>{name}</b><small>{service}</small></span><em className={`status-${index}`}>{status}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="hero-floating-card hero-floating-card--payment">
                <span><CircleCheck size={17} /></span>
                <div><strong>Pagamento recebido</strong><small>R$ 65,00 via Pix</small></div>
              </div>
              <div className="hero-floating-card hero-floating-card--message">
                <span><MessageCircle size={17} /></span>
                <div><strong>Lembrete enviado</strong><small>WhatsApp · agora</small></div>
              </div>
            </div>
          </div>
          <div className="landing-container hero-highlights">
            <span><Check size={15} /> Configuração em minutos</span>
            <span><Check size={15} /> Sem taxa por reserva</span>
            <span><Check size={15} /> Suporte em português</span>
          </div>
        </section>

        <section className="feature-section" id="produto">
          <div className="landing-container">
            <div className="landing-section-title">
              <span>Operação completa</span>
              <h2>Menos improviso.<br />Mais barbearia.</h2>
              <p>Tudo conectado, do primeiro agendamento ao fechamento da comissão.</p>
            </div>
            <div className="feature-grid">
              {featureCards.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article className={`feature-card feature-card--${feature.tone}`} key={feature.title}>
                    <span className="feature-card__icon"><Icon size={23} /></span>
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                    <Link href="/entrar?modo=cadastro">Explorar recurso <ChevronRight size={15} /></Link>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="experience-section" id="como-funciona">
          <div className="landing-container experience-grid">
            <div className="client-phone-stage">
              <div className="client-phone">
                <div className="client-phone__speaker" />
                <div className="client-phone__screen">
                  <span className="client-phone__logo">LB</span>
                  <small>LOS BARBEROS</small>
                  <h3>Como quer cuidar do visual?</h3>
                  {[
                    ["Corte clássico", "45 min", "R$ 65"],
                    ["Barba premium", "45 min", "R$ 55"],
                    ["Corte + barba", "1h 30", "R$ 105"],
                  ].map(([name, time, price], index) => (
                    <div className={`client-phone__service ${index === 2 ? "selected" : ""}`} key={name}>
                      <span><Scissors size={16} /></span><div><b>{name}</b><small>{time}</small></div><strong>{price}</strong>
                    </div>
                  ))}
                  <button>Continuar <ArrowRight size={15} /></button>
                </div>
              </div>
              <span className="phone-badge phone-badge--one"><Clock3 size={16} /> Reserve em 30 segundos</span>
              <span className="phone-badge phone-badge--two"><ShieldCheck size={16} /> Sinal protegido</span>
            </div>
            <div className="experience-copy">
              <span className="landing-kicker">Experiência do cliente</span>
              <h2>Agendar deve ser tão bom quanto o atendimento.</h2>
              <p>Uma PWA rápida, elegante e com a identidade da sua barbearia. Sem baixar app, sem criar senha complicada.</p>
              <ol className="experience-steps">
                <li><span>01</span><div><strong>Escolhe o serviço</strong><small>Catálogo e combos com preços transparentes.</small></div></li>
                <li><span>02</span><div><strong>Encontra o melhor horário</strong><small>Disponibilidade real de cada profissional.</small></div></li>
                <li><span>03</span><div><strong>Confirma com segurança</strong><small>Pix ou cartão e lembrete no WhatsApp.</small></div></li>
              </ol>
              <Link className="text-link" href="/cliente/agendar">Experimentar como cliente <ArrowRight size={17} /></Link>
            </div>
          </div>
        </section>

        <section className="outcomes-section">
          <div className="landing-container outcomes-grid">
            <div><strong>+32%</strong><span>mais reservas confirmadas</span></div>
            <div><strong>-61%</strong><span>menos faltas e atrasos</span></div>
            <div><strong>8h</strong><span>economizadas por semana</span></div>
            <div><strong>4,9/5</strong><span>satisfação dos clientes</span></div>
          </div>
        </section>

        <section className="pricing-section" id="preco">
          <div className="landing-container pricing-grid">
            <div className="pricing-copy">
              <span className="landing-kicker">Preço simples</span>
              <h2>Um plano.<br />A barbearia inteira.</h2>
              <p>Sem cobrar por profissional, por reserva ou por mensagem enviada.</p>
              <div className="pricing-testimonial">
                <div className="hero-proof__stars"><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /></div>
                <blockquote>“Hoje eu abro o painel e sei exatamente como o dia vai rodar. Virou parte da barbearia.”</blockquote>
                <span><i>RM</i><small><b>Ricardo Monteiro</b>Barbearia Central, SP</small></span>
              </div>
            </div>
            <article className="pricing-card">
              <div className="pricing-card__top"><span>Plano completo</span><small>Mais escolhido</small></div>
              <div className="pricing-card__price pricing-card__price--dynamic"><strong>Valor do plano</strong><span>vigente no checkout Stripe</span></div>
              <p>Uma unidade · equipe ilimitada · valor ilustrado somente no checkout</p>
              <ul>
                {["Agenda online e painel completo", "PWA personalizada para clientes", "Pagamentos e sinal online", "WhatsApp transacional", "Comissões e relatórios", "Suporte humano em português"].map((item) => <li key={item}><CircleCheck size={17} />{item}</li>)}
              </ul>
              <Link href="/entrar?modo=cadastro" className="button button--accent button--block">Começar 14 dias grátis <ArrowRight size={17} /></Link>
              <small>Não pedimos compromisso. Cancele quando quiser.</small>
            </article>
          </div>
        </section>

        <section className="landing-final-cta">
          <div className="landing-final-cta__pattern" />
          <div className="landing-container">
            <span><Zap size={17} /> Pronto para organizar a casa?</span>
            <h2>Sua melhor semana na barbearia pode começar hoje.</h2>
            <Link href="/entrar?modo=cadastro" className="button button--accent button--lg">Criar minha barbearia <ArrowRight size={18} /></Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__grid">
          <div><Brand light /><p>Gestão simples para quem leva a barbearia a sério.</p></div>
          <div><strong>Produto</strong><Link href="/entrar?modo=login">Painel do gestor</Link><Link href="/cliente/agendar">Experiência cliente</Link><a href="#preco">Preço</a></div>
          <div><strong>Empresa</strong><a href="#produto">Sobre</a><a href="mailto:contato@losbarberos.com.br">Contato</a><Link href="/privacidade">Privacidade</Link><Link href="/termos">Termos de uso</Link><Link href="/exclusao-de-dados">Exclusão de dados</Link></div>
          <div><strong>Acompanhe</strong><span>Instagram</span><span>WhatsApp</span><span>LinkedIn</span></div>
        </div>
        <div className="landing-container landing-footer__bottom"><span>© 2026 Los Barberos</span><span>Feito no Brasil · BRL · PT-BR</span></div>
      </footer>
    </div>
  );
}
