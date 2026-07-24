import { listSellers } from "./sellers.service";
import type { OmieServiceContext } from "./service-context";
import { isOmieIntegrationError } from "../errors/omie-error";

/**
 * Teste de conexão usado pelo painel administrativo (briefing §30).
 *
 * Escolha da chamada: `ListarVendedores` com uma única página de um registro.
 * Critérios: é leitura (não altera nada no ERP), é barata, e exercita justamente
 * o que o administrador quer verificar — que a `app_key`/`app_secret` são
 * válidas e que a conta responde.
 */
export type ConnectionTestResult =
  | { readonly ok: true; readonly detail: string; readonly sellersFound: number }
  | {
      readonly ok: false;
      readonly detail: string;
      readonly code: string;
      readonly correlationId: string;
    };

export async function testConnection(
  context: OmieServiceContext,
): Promise<ConnectionTestResult> {
  try {
    const page = await listSellers(context, { page: 1, pageSize: 1 });
    return {
      ok: true,
      detail: `Conexão bem-sucedida. ${page.totalRecords} vendedor(es) cadastrado(s) no Omie.`,
      sellersFound: page.totalRecords,
    };
  } catch (error) {
    if (isOmieIntegrationError(error)) {
      return {
        ok: false,
        // `omieDescription` vem da Omie e é diagnóstico legítimo para o
        // administrador (ex.: "app_key inválida"). Não contém segredo nosso.
        detail: describeFailure(error.code, error.omieDescription),
        code: error.code,
        correlationId: error.correlationId,
      };
    }

    return {
      ok: false,
      detail: "Falha inesperada ao testar a conexão.",
      code: "UNKNOWN_ERROR",
      correlationId: "-",
    };
  }
}

function describeFailure(code: string, omieDescription?: string): string {
  const base = ((): string => {
    switch (code) {
      case "AUTHENTICATION_ERROR":
        return "Credenciais recusadas pelo Omie. Confira app_key e app_secret.";
      case "RATE_LIMIT_ERROR":
        return "Limite de requisições do Omie atingido. Tente novamente em instantes.";
      case "TIMEOUT_ERROR":
        return "O Omie não respondeu no tempo esperado.";
      case "NETWORK_ERROR":
        return "Não foi possível alcançar o Omie.";
      case "CIRCUIT_OPEN":
        return "Chamadas ao Omie estão temporariamente suspensas após falhas consecutivas.";
      case "SCHEMA_ERROR":
        return "O Omie respondeu em formato inesperado. A equipe técnica precisa revisar a integração.";
      default:
        return "O Omie recusou a chamada de teste.";
    }
  })();

  return omieDescription ? `${base} (${omieDescription})` : base;
}
