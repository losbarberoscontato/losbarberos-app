import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { publicSite } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Condições de uso da plataforma Los Barberos.",
  alternates: { canonical: "/termos" },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Condições do serviço"
      title="Termos de Uso"
      description="Estas condições regulam o acesso e o uso da plataforma Los Barberos por gestores, equipes e clientes de barbearias."
    >
      <section>
        <h2>1. Aceitação e capacidade</h2>
        <p>Ao criar uma conta ou usar a plataforma, você declara ter capacidade legal para aceitar estes termos. Quando agir por uma empresa ou barbearia, declara possuir poderes para representá-la.</p>
      </section>

      <section>
        <h2>2. O que o Los Barberos oferece</h2>
        <p>Fornecemos tecnologia para gestão de barbearias, agenda, relacionamento com clientes, equipe, recursos financeiros e integrações. O atendimento de beleza é prestado pela barbearia e pelos profissionais, não pelo Los Barberos.</p>
      </section>

      <section>
        <h2>3. Contas e segurança</h2>
        <p>As informações de cadastro devem ser verdadeiras e atualizadas. Cada pessoa deve proteger suas credenciais, limitar acessos às funções necessárias e comunicar imediatamente qualquer suspeita de uso indevido.</p>
      </section>

      <section>
        <h2>4. Responsabilidades da barbearia</h2>
        <p>A barbearia é responsável pela qualidade e legalidade dos serviços oferecidos, preços, horários, profissionais, informações prestadas aos clientes e cumprimento das normas de consumo, fiscais, trabalhistas e sanitárias aplicáveis.</p>
        <p>Também deve possuir base legal adequada para inserir, consultar e utilizar dados pessoais de clientes e colaboradores, fornecer os avisos necessários e atender solicitações dos titulares quando atuar como controladora.</p>
      </section>

      <section>
        <h2>5. Agendamentos, pagamentos e integrações</h2>
        <p>Vagas e durações dependem da configuração da barbearia e da disponibilidade confirmada pelo sistema. Cancelamentos, atrasos, reembolsos e prestação do serviço observam as regras informadas pela barbearia e os direitos obrigatórios do consumidor.</p>
        <p>Pagamentos e comunicações podem ser processados por terceiros, como Stripe, Mercado Pago e Meta/WhatsApp, quando habilitados. O uso desses recursos também está sujeito aos termos dos respectivos provedores.</p>
      </section>

      <section>
        <h2>6. Uso permitido</h2>
        <p>É proibido usar a plataforma para fraude, violação de direitos, envio de mensagens sem base legal, acesso não autorizado, engenharia reversa indevida, interferência na segurança ou atividades ilícitas. Podemos limitar acessos para proteger usuários e a plataforma.</p>
      </section>

      <section>
        <h2>7. Propriedade intelectual e disponibilidade</h2>
        <p>O software, a marca e os elementos próprios do Los Barberos permanecem protegidos por direitos de propriedade intelectual. O conteúdo inserido pela barbearia continua sob responsabilidade de seu titular.</p>
        <p>Buscamos manter o serviço disponível e seguro, mas podem ocorrer manutenções, indisponibilidades de terceiros ou eventos fora de controle razoável. Não excluímos garantias ou responsabilidades que a lei proíba excluir.</p>
      </section>

      <section>
        <h2>8. Suspensão, encerramento e alterações</h2>
        <p>O acesso pode ser suspenso por risco de segurança, inadimplência, uso ilícito ou violação relevante destes termos, respeitados os direitos legais e contratuais aplicáveis. O encerramento não elimina obrigações pendentes nem registros que devam ser preservados.</p>
        <p>Podemos atualizar estes termos por mudanças legais, técnicas ou de produto. Alterações relevantes serão comunicadas por meio apropriado antes de produzirem efeitos, quando exigido.</p>
      </section>

      <section>
        <h2>9. Lei aplicável e contato</h2>
        <p>Estes termos são regidos pela legislação brasileira. Fica preservado o foro legalmente competente, inclusive o foro do domicílio do consumidor quando aplicável.</p>
        <p>Dúvidas podem ser enviadas para <a href={`mailto:${publicSite.privacyEmail}`}>{publicSite.privacyEmail}</a>.</p>
      </section>
    </LegalPage>
  );
}
