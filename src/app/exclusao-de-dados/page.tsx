import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { publicSite } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Exclusão de Dados",
  description: "Instruções para solicitar a exclusão de dados pessoais no Los Barberos.",
  alternates: { canonical: "/exclusao-de-dados" },
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Direitos do titular"
      title="Exclusão de Dados"
      description="Você pode solicitar a exclusão da conta e dos dados pessoais associados por uma das opções abaixo."
    >
      <section>
        <h2>1. Pelo aplicativo</h2>
        <ol>
          <li>Entre na sua conta conectada do Los Barberos.</li>
          <li>Acesse <strong>Perfil e privacidade</strong>.</li>
          <li>Selecione <strong>Solicitar exclusão</strong> e confirme as instruções exibidas.</li>
        </ol>
      </section>

      <section>
        <h2>2. Por e-mail</h2>
        <p>Se não conseguir entrar na conta, envie um e-mail com o assunto <strong>Solicitação de exclusão de dados</strong> para <a href={`mailto:${publicSite.privacyEmail}`}>{publicSite.privacyEmail}</a>.</p>
        <p>Informe o e-mail ou telefone usado na conta e, se houver, a barbearia relacionada. Não envie senha, documento completo ou dados de cartão. Poderemos pedir uma confirmação adicional por canal seguro.</p>
      </section>

      <section>
        <h2>3. O que acontece depois</h2>
        <p>Após validar sua identidade e o alcance da solicitação, eliminaremos ou anonimizaremos os dados abrangidos e comunicaremos a conclusão nos prazos aplicáveis. Quando a barbearia for controladora dos dados, poderemos encaminhar a solicitação para que ela também adote as providências necessárias.</p>
      </section>

      <section>
        <h2>4. Dados que podem ser mantidos</h2>
        <p>Alguns registros podem ser preservados quando necessários ao cumprimento de obrigação legal ou regulatória, à prevenção de fraude, ao exercício regular de direitos ou a outras hipóteses autorizadas pela LGPD. Esses dados permanecem restritos às finalidades que justificam sua retenção.</p>
      </section>
    </LegalPage>
  );
}
