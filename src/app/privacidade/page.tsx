import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { publicSite } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Saiba como o Los Barberos trata e protege dados pessoais.",
  alternates: { canonical: "/privacidade" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacidade e LGPD"
      title="Política de Privacidade"
      description="Este aviso explica quais dados pessoais tratamos, por que os utilizamos, com quem podem ser compartilhados e como você pode exercer seus direitos."
    >
      <section>
        <h2>1. Quem é responsável</h2>
        <p>
          O Los Barberos é operado por <strong>{publicSite.legalName}</strong>. Somos o controlador dos dados próprios da plataforma, como cadastro, segurança e relacionamento com usuários.
        </p>
        <p>
          Também podemos atuar como operador quando tratar dados pessoais em nome das barbearias que usam o sistema. Nesses casos, a barbearia define as finalidades do tratamento e deve possuir base legal adequada.
        </p>
      </section>

      <section>
        <h2>2. Dados que podemos tratar</h2>
        <ul>
          <li>Cadastro e perfil: nome, telefone, e-mail, credenciais protegidas e preferências.</li>
          <li>Agendamentos e atendimento: barbearia, profissional, serviço, data, horário e histórico operacional.</li>
          <li>Pagamentos: status, valor, método e identificadores da transação. Não armazenamos os dados completos do cartão.</li>
          <li>Comunicações: mensagens e eventos de entrega, inclusive WhatsApp quando a integração estiver habilitada.</li>
          <li>Dados técnicos: endereço IP, dispositivo, navegador, registros de acesso, sessão, segurança e prevenção a fraude.</li>
        </ul>
      </section>

      <section>
        <h2>3. Finalidades e bases legais</h2>
        <p>Usamos dados para criar e proteger contas, viabilizar agendamentos, executar os serviços contratados, processar pagamentos, prestar suporte, enviar comunicações operacionais, cumprir obrigações legais e prevenir abuso.</p>
        <p>Conforme o contexto, o tratamento pode se apoiar na execução de contrato, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo interesse ou consentimento, quando aplicável.</p>
      </section>

      <section>
        <h2>4. Compartilhamento e transferências</h2>
        <p>Não vendemos dados pessoais. Podemos compartilhar somente o necessário com a barbearia relacionada ao atendimento e com fornecedores tecnológicos que sustentam recursos efetivamente habilitados, como Supabase, Vercel, Stripe, Mercado Pago, Meta/WhatsApp e serviços de suporte ou nuvem.</p>
        <p>Alguns fornecedores podem tratar dados fora do Brasil. Nesses casos, adotamos contratos, controles de segurança e outros mecanismos previstos na legislação aplicável para transferências internacionais.</p>
      </section>

      <section>
        <h2>5. Cookies e tecnologias semelhantes</h2>
        <p>Atualmente usamos cookies estritamente necessários para autenticação, sessão, segurança e funcionamento da plataforma. Caso sejam adotadas tecnologias não essenciais, este aviso e os mecanismos de escolha serão atualizados antes do uso.</p>
      </section>

      <section>
        <h2>6. Retenção e segurança</h2>
        <p>Conservamos dados pelo tempo necessário às finalidades informadas e aos prazos legais, regulatórios, contratuais ou de exercício de direitos. Depois, os dados são eliminados ou anonimizados quando aplicável.</p>
        <p>Usamos medidas técnicas e administrativas proporcionais aos riscos. Nenhum ambiente é absolutamente invulnerável; por isso, também monitoramos eventos e aprimoramos controles continuamente.</p>
      </section>

      <section>
        <h2>7. Seus direitos</h2>
        <p>Nos termos da LGPD, você pode solicitar confirmação da existência de tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade quando regulamentada, informações sobre compartilhamento, revisão de decisões automatizadas, revogação do consentimento e oposição nos casos cabíveis.</p>
        <p>Para exercer direitos, escreva para <a href={`mailto:${publicSite.privacyEmail}`}>{publicSite.privacyEmail}</a>. Poderemos solicitar confirmação razoável de identidade para proteger a conta e os dados.</p>
      </section>

      <section>
        <h2>8. Crianças, atualizações e contato</h2>
        <p>O serviço não é direcionado diretamente a crianças. O cadastro ou atendimento de menores deve ocorrer com participação e responsabilidade de seu representante legal, conforme a legislação aplicável.</p>
        <p>Podemos atualizar esta política para refletir mudanças legais, técnicas ou operacionais. A versão vigente e sua data permanecem publicadas nesta página.</p>
      </section>
    </LegalPage>
  );
}
