import type {
  OmieErrorDisposition,
  OmieIntegrationErrorCode,
} from "./omie-error";

/**
 * Classificação de erros da Omie.
 *
 * IMPORTANTE: a Omie **não publica um envelope de erro uniforme** para JSON
 * (ver docs/omie-api-mapping.md §1 e §12, item 7). O que existe documentado são
 * mensagens específicas, listadas no artigo oficial de tratamento de erros
 * (ajuda.omie.com.br/pt-BR/articles/8001888). Os padrões abaixo derivam
 * exclusivamente dessas mensagens documentadas — nenhum foi inventado.
 *
 * Consequência de desenho: qualquer coisa não reconhecida cai em
 * `UNKNOWN_ERROR`, e a decisão de reenviar depende de a chamada ser leitura ou
 * escrita. Para escrita desconhecida, o resultado é `UNCERTAIN_RESULT` — nunca
 * um reenvio automático, porque isso é exatamente como se criam pedidos
 * duplicados.
 */

/** Padrões de mensagem documentados oficialmente pela Omie. */
const DOCUMENTED_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly code: OmieIntegrationErrorCode;
  readonly source: string;
}> = [
  {
    // "Too Many Requests" — limite de 240 requisições/minuto.
    pattern: /too many requests|excedeu o limite|limite de consumo/i,
    code: "RATE_LIMIT_ERROR",
    source: "artigo oficial: limite de 240 req/min",
  },
  {
    // "[Item] já cadastrado para o código de integração [xxxx]"
    pattern: /j[áa] cadastrad[oa].*c[óo]digo de integra[çc][ãa]o/i,
    code: "CONFLICT_ERROR",
    source: "artigo oficial: duplicidade por código de integração",
  },
  {
    // "[Item] não cadastrado para o número [xxxx]"
    pattern: /n[ãa]o cadastrad[oa]|n[ãa]o encontrad[oa]/i,
    code: "RESOURCE_NOT_FOUND",
    source: "artigo oficial: registro inexistente",
  },
  {
    // "O preenchimento da tag [xxxx] é obrigatório"
    pattern: /preenchimento da tag.*obrigat[óo]ri/i,
    code: "VALIDATION_ERROR",
    source: "artigo oficial: campo obrigatório ausente",
  },
  {
    // "O número máximo de caracteres permitido para o elemento [xxxx] é de X"
    pattern: /n[úu]mero m[áa]ximo de caracteres/i,
    code: "VALIDATION_ERROR",
    source: "artigo oficial: limite de caracteres excedido",
  },
  {
    // "Invalid JSON Object" / "JSON request with SyntaxError"
    pattern: /invalid json|syntaxerror/i,
    code: "VALIDATION_ERROR",
    source: "artigo oficial: JSON malformado",
  },
  {
    // Falha de autenticação por app_key/app_secret.
    pattern: /app_key|app_secret|n[ãa]o autorizad|unauthorized|acesso negado/i,
    code: "AUTHENTICATION_ERROR",
    source: "credenciais inválidas",
  },
  {
    // "PROTO_BYEBYE" — instabilidade do ambiente, com processamento parcial.
    // Documentado explicitamente como podendo deixar a operação incompleta.
    pattern: /proto_byebye/i,
    code: "NETWORK_ERROR",
    source: "artigo oficial: instabilidade com processamento parcial",
  },
];

const DISPOSITION_BY_CODE: Record<
  OmieIntegrationErrorCode,
  OmieErrorDisposition
> = {
  AUTHENTICATION_ERROR: "AUTHENTICATION_REQUIRED",
  VALIDATION_ERROR: "NON_RETRYABLE",
  RATE_LIMIT_ERROR: "RETRYABLE",
  TIMEOUT_ERROR: "RETRYABLE",
  NETWORK_ERROR: "RETRYABLE",
  RESOURCE_NOT_FOUND: "NON_RETRYABLE",
  CONFLICT_ERROR: "NON_RETRYABLE",
  CIRCUIT_OPEN: "RETRYABLE",
  SCHEMA_ERROR: "MANUAL_REVIEW_REQUIRED",
  UNKNOWN_ERROR: "RETRYABLE",
};

export interface ClassificationInput {
  readonly httpStatus?: number | undefined;
  readonly message?: string | undefined;
  readonly omieCode?: string | number | undefined;
  /**
   * `true` para chamadas que alteram estado no Omie (Incluir/Alterar/Trocar).
   * Muda a classificação de erros ambíguos: uma escrita cujo resultado é
   * desconhecido nunca pode ser reenviada automaticamente.
   */
  readonly isWrite: boolean;
}

export interface Classification {
  readonly code: OmieIntegrationErrorCode;
  readonly disposition: OmieErrorDisposition;
  /** Qual regra produziu a classificação — vai para o log, ajuda a auditar. */
  readonly matchedBy: string;
}

export function classifyOmieError(input: ClassificationInput): Classification {
  const text = `${input.message ?? ""} ${input.omieCode ?? ""}`;

  for (const { pattern, code, source } of DOCUMENTED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        code,
        disposition: refineDisposition(code, input.isWrite),
        matchedBy: source,
      };
    }
  }

  // Sem padrão documentado reconhecido, o status HTTP é o único sinal confiável.
  const status = input.httpStatus;

  if (status === 429) {
    return {
      code: "RATE_LIMIT_ERROR",
      disposition: "RETRYABLE",
      matchedBy: "HTTP 429",
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: "AUTHENTICATION_ERROR",
      disposition: "AUTHENTICATION_REQUIRED",
      matchedBy: `HTTP ${status}`,
    };
  }

  if (status !== undefined && status >= 500) {
    // HTTP 500 na Omie cobre tanto parâmetro inválido quanto instabilidade
    // (documentado). Não é possível distinguir pelo status: para escrita,
    // tratamos como resultado incerto.
    return {
      code: "UNKNOWN_ERROR",
      disposition: input.isWrite ? "UNCERTAIN_RESULT" : "RETRYABLE",
      matchedBy: `HTTP ${status} sem mensagem reconhecida`,
    };
  }

  if (status !== undefined && status >= 400) {
    return {
      code: "VALIDATION_ERROR",
      disposition: "NON_RETRYABLE",
      matchedBy: `HTTP ${status}`,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    disposition: input.isWrite ? "UNCERTAIN_RESULT" : "RETRYABLE",
    matchedBy: "nenhum padrão reconhecido",
  };
}

/**
 * Timeout e falha de rede em escrita são o caso clássico de resultado incerto:
 * a requisição pode ter chegado e sido processada.
 */
export function classifyTransportFailure(
  kind: "timeout" | "network",
  isWrite: boolean,
): Classification {
  const code: OmieIntegrationErrorCode =
    kind === "timeout" ? "TIMEOUT_ERROR" : "NETWORK_ERROR";
  return {
    code,
    disposition: isWrite ? "UNCERTAIN_RESULT" : "RETRYABLE",
    matchedBy: `falha de transporte: ${kind}`,
  };
}

function refineDisposition(
  code: OmieIntegrationErrorCode,
  isWrite: boolean,
): OmieErrorDisposition {
  if (code === "NETWORK_ERROR" && isWrite) {
    // PROTO_BYEBYE em escrita: documentado como podendo processar parcialmente.
    return "UNCERTAIN_RESULT";
  }
  return DISPOSITION_BY_CODE[code];
}

/** Nomes de método da Omie que alteram estado. */
const WRITE_CALL_PREFIXES = [
  "Incluir",
  "Alterar",
  "Excluir",
  "Upsert",
  "Associar",
  "Trocar",
  "Devolver",
  "Ativar",
  "Suspender",
  "Atualizar",
  "Faturar",
] as const;

export function isWriteCall(call: string): boolean {
  return WRITE_CALL_PREFIXES.some((prefix) => call.startsWith(prefix));
}
