import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  Clock3,
  Scissors,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { Brand } from "@/components/brand";

const managerBenefits = [
  {
    icon: CalendarCheck2,
    title: "Agenda que respeita seu dia",
    text: "Veja horários, encaixes e confirmações sem caçar conversas no WhatsApp.",
  },
  {
    icon: Users,
    title: "Equipe na mesma página",
    text: "Cada profissional, serviço e atendimento aparece onde a decisão acontece.",
  },
  {
    icon: WalletCards,
    title: "Caixa sem adivinhação",
    text: "Acompanhe recebimentos e rotina financeira em vez de fechar o dia no escuro.",
  },
];

const setupSteps = [
  ["Crie sua barbearia", "Informe o básico para abrir seu ambiente."],
  ["Organize a operação", "Cadastre equipe, serviços e horários no seu ritmo."],
  ["Comece o teste", "Use o painel por 14 dias sem cartão nesta fase."],
];

export default function HomePage() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-container landing-nav__inner">
          <Brand />
          <nav aria-label="Navegação principal">
            <a href="#rotina">Rotina</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#teste">Teste grátis</a>
          </nav>
          <Link href="/entrar?modo=login" className="landing-login-link">Entrar</Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero__grid">
            <div className="landing-hero__copy">
              <h1>Horário vazio custa caro.<br /><em>Gestão improvisada custa mais.</em></h1>
              <p>Los Barberos reúne agenda, clientes, equipe e caixa para você saber o que acontece na barbearia sem depender de memória, conversa solta ou planilha.</p>
              <div className="landing-hero__actions">
                <Link href="/entrar?modo=cadastro" className="button button--accent button--lg">
                  Criar minha barbearia <ArrowRight size={18} />
                </Link>
                <Link href="/entrar?modo=login" className="button landing-button--secondary button--lg">
                  Entrar no painel
                </Link>
              </div>
              <p className="landing-hero__assurance"><ShieldCheck size={16} /> 14 dias grátis · sem cartão nesta fase</p>
            </div>

            <figure className="hero-product" aria-label="Prévia ilustrativa do painel Los Barberos">
              <div className="hero-dashboard">
                <aside className="hero-dashboard__rail" aria-hidden="true">
                  <span className="hero-dashboard__logo">LB</span>
                  {['agenda', 'equipe', 'caixa'].map((item, index) => <span key={item} className={index === 0 ? 'active' : ''} />)}
                </aside>
                <div className="hero-dashboard__body">
                  <div className="hero-dashboard__top">
                    <span><b>Bom dia, gestor</b><small>Seu dia em um só lugar</small></span>
                    <i>LB</i>
                  </div>
                  <div className="hero-dashboard__focus">
                    <span>Agenda de hoje</span>
                    <strong>Atendimentos, equipe e próximos horários</strong>
                    <small>Organize o que importa antes da cadeira ficar vazia.</small>
                  </div>
                  <div className="hero-dashboard__agenda">
                    <div className="hero-dashboard__section-title"><b>Próximos horários</b><small>Agenda</small></div>
                    {[
                      ['09:30', 'Corte clássico', 'Confirmado'],
                      ['10:45', 'Barba premium', 'Em atendimento'],
                      ['11:45', 'Corte + barba', 'Aguardando confirmação'],
                    ].map(([time, service, status], index) => (
                      <div className="hero-dashboard__row" key={time}>
                        <time>{time}</time><i className={`tone-${index}`}><Scissors size={12} /></i><span><b>{service}</b><small>Visualização de exemplo</small></span><em className={`status-${index}`}>{status}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <figcaption><span>Painel do gestor</span><span>Dados ilustrativos</span></figcaption>
              <div className="hero-floating-card hero-floating-card--agenda"><CalendarCheck2 size={17} /><span>Agenda organizada</span></div>
              <div className="hero-floating-card hero-floating-card--team"><Users size={17} /><span>Equipe visível</span></div>
            </figure>
          </div>
        </section>

        <section className="landing-routine" id="rotina">
          <div className="landing-container landing-routine__grid">
            <div>
              <h2>Quando operação fica clara, atendimento volta a ser prioridade.</h2>
              <p>Menos tempo ligando pontos. Mais tempo decidindo o próximo passo da sua barbearia.</p>
              <ul className="landing-benefit-list">
                {managerBenefits.map(({ icon: Icon, title, text }) => (
                  <li key={title}><Icon size={20} /><span><strong>{title}</strong><small>{text}</small></span></li>
                ))}
              </ul>
            </div>
            <div className="routine-board" aria-label="Resumo ilustrativo da rotina do gestor">
              <div className="routine-board__header"><span>Rotina de gestão</span><i><Clock3 size={16} /></i></div>
              <div className="routine-board__line"><span className="routine-board__dot routine-board__dot--gold" /><div><strong>Abra o dia sabendo quem chega</strong><small>Agenda e confirmações no mesmo painel.</small></div></div>
              <div className="routine-board__line"><span className="routine-board__dot" /><div><strong>Acompanhe atendimento sem interromper equipe</strong><small>Informação acessível quando precisar decidir.</small></div></div>
              <div className="routine-board__line"><span className="routine-board__dot routine-board__dot--soft" /><div><strong>Feche com visão do caixa</strong><small>Recebimentos deixam de ficar espalhados.</small></div></div>
              <small className="routine-board__note">Exemplo de organização do painel</small>
            </div>
          </div>
        </section>

        <section className="landing-setup" id="como-funciona">
          <div className="landing-container">
            <div className="landing-setup__heading">
              <h2>Comece sem transformar sua rotina em projeto.</h2>
              <p>Você configura o essencial e vai aprofundando o uso conforme a operação pede.</p>
            </div>
            <ol className="landing-setup__steps">
              {setupSteps.map(([title, text], index) => (
                <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{title}</strong><p>{text}</p></div></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-trial" id="teste">
          <div className="landing-container landing-trial__inner">
            <div><h2>Veja sua operação com menos ruído por 14 dias.</h2><p>Crie sua barbearia, explore o painel e decida com calma. Sem cartão agora.</p></div>
            <Link href="/entrar?modo=cadastro" className="button button--accent button--lg">Começar 14 dias grátis <ArrowRight size={18} /></Link>
          </div>
        </section>

        <section className="landing-final-cta">
          <div className="landing-container">
            <h2>Sua barbearia não precisa rodar no improviso.</h2>
            <p>Crie seu ambiente e comece pelo que organiza o dia de hoje.</p>
            <Link href="/entrar?modo=cadastro" className="button button--accent button--lg">Criar minha barbearia <ArrowRight size={18} /></Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer__grid">
          <div><Brand light /><p>Gestão para barbearias que querem enxergar a própria operação.</p></div>
          <div><strong>Acesso</strong><Link href="/entrar?modo=login">Entrar no painel</Link><Link href="/entrar?modo=cadastro">Criar minha barbearia</Link></div>
          <div><strong>Empresa</strong><a href="mailto:contato@losbarberos.com.br">Contato</a><Link href="/privacidade">Privacidade</Link><Link href="/termos">Termos de uso</Link></div>
        </div>
        <div className="landing-container landing-footer__bottom"><span>© 2026 Los Barberos</span><span>Feito no Brasil · BRL · PT-BR</span></div>
      </footer>
    </div>
  );
}
