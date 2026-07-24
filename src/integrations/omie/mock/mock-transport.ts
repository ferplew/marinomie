import type {
  OmieTransport,
  TransportRequest,
  TransportResponse,
} from "../client/transport";
import {
  mockCustomers,
  mockPriceTableItems,
  mockProducts,
  mockSellers,
  mockStockByProduct,
  mockWarehouses,
} from "./fixtures";

/**
 * Transporte mock (`OMIE_MOCK_MODE=true`).
 *
 * Implementa a mesma interface do transporte real, então tudo acima dele —
 * retry, rate limit, breaker, validação de schema, mapeamento — é exercitado de
 * verdade. Se um schema estiver errado, o mock quebra do mesmo jeito que a API
 * real quebraria; é isso que impede o mock de virar uma ilusão de que funciona.
 *
 * O que ele **não** faz: simular latência da Omie, ordenação real ou filtros
 * completos. Fica registrado em docs/known-limitations.md.
 */
export class MockOmieTransport implements OmieTransport {
  readonly mode = "mock" as const;

  /** Credenciais que o mock aceita. Vazias falham, para exercitar erro de auth. */
  private readonly requireCredentials: boolean;

  constructor(options: { requireCredentials?: boolean } = {}) {
    this.requireCredentials = options.requireCredentials ?? true;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    // Mantém a assinatura assíncrona coerente com o transporte real.
    await Promise.resolve();

    if (
      this.requireCredentials &&
      (request.appKey.length === 0 || request.appSecret.length === 0)
    ) {
      return {
        httpStatus: 401,
        body: {
          faultcode: "SOAP-ENV:Client-102",
          faultstring: "app_key inválida ou não informada.",
        },
        rawText: undefined,
      };
    }

    const body = this.route(request);
    if (body === null) {
      // Método não implementado no mock: erro explícito, nunca resposta vazia
      // que passaria por sucesso.
      return {
        httpStatus: 500,
        body: {
          faultcode: "SOAP-ENV:Client-101",
          faultstring: `Método não implementado no modo mock: ${request.call}`,
        },
        rawText: undefined,
      };
    }

    return { httpStatus: 200, body, rawText: undefined };
  }

  private route(request: TransportRequest): unknown {
    switch (request.call) {
      case "ListarProdutos":
        return paginateFixture(request.param, [...mockProducts], {
          arrayKey: "produto_servico_cadastro",
          style: "snake",
        });

      case "ListarProdutosResumido":
        return paginateFixture(
          request.param,
          mockProducts.map((p) => ({
            codigo_produto: p.codigo_produto,
            codigo_produto_integracao: p.codigo_produto_integracao,
            codigo: p.codigo,
            descricao: p.descricao,
            valor_unitario: p.valor_unitario,
          })),
          { arrayKey: "produto_servico_resumido", style: "snake" },
        );

      case "ConsultarProduto": {
        const omieId = numberParam(request.param, "codigo_produto");
        const sku = stringParam(request.param, "codigo");
        const found = mockProducts.find(
          (p) => p.codigo_produto === omieId || p.codigo === sku,
        );
        return found ?? notFound("Produto");
      }

      case "ObterEstoqueProduto": {
        const omieId = numberParam(request.param, "nIdProduto");
        const sku = stringParam(request.param, "cCodigo");
        const product = mockProducts.find(
          (p) => p.codigo_produto === omieId || p.codigo === sku,
        );
        if (!product) return notFound("Produto");

        return {
          nIdProduto: product.codigo_produto,
          cCodigo: product.codigo,
          cDescricao: product.descricao,
          cEAN: product.ean,
          cUnidade: product.unidade,
          cNCM: product.ncm,
          listaEstoque: mockStockByProduct[product.codigo_produto] ?? [],
        };
      }

      case "ListarLocaisEstoque":
        return paginateFixture(request.param, [...mockWarehouses], {
          arrayKey: "locaisEncontrados",
          style: "hungarian",
        });

      case "ListarClientes":
        return paginateFixture(request.param, [...mockCustomers], {
          arrayKey: "clientes_cadastro",
          style: "snake",
        });

      case "ListarClientesResumido":
        return paginateFixture(
          request.param,
          mockCustomers.map((c) => ({
            // A listagem resumida usa `codigo_cliente`, não `codigo_cliente_omie`.
            codigo_cliente: c.codigo_cliente_omie,
            codigo_cliente_integracao: c.codigo_cliente_integracao,
            razao_social: c.razao_social,
            nome_fantasia: c.nome_fantasia,
            cnpj_cpf: c.cnpj_cpf,
          })),
          { arrayKey: "clientes_cadastro_resumido", style: "snake" },
        );

      case "ConsultarCliente": {
        const omieId = numberParam(request.param, "codigo_cliente_omie");
        const integrationCode = stringParam(
          request.param,
          "codigo_cliente_integracao",
        );
        const found = mockCustomers.find(
          (c) =>
            c.codigo_cliente_omie === omieId ||
            c.codigo_cliente_integracao === integrationCode,
        );
        return found ?? notFound("Cliente");
      }

      case "UpsertClienteCpfCnpj":
      case "IncluirCliente":
      case "AlterarCliente": {
        const integrationCode = stringParam(
          request.param,
          "codigo_cliente_integracao",
        );
        const document = stringParam(request.param, "cnpj_cpf");
        const existing = mockCustomers.find(
          (c) => c.cnpj_cpf.replace(/\D/g, "") === (document ?? "").replace(/\D/g, ""),
        );

        return {
          // Reusa o id quando o documento já existe: é o comportamento de upsert
          // que o código de idempotência precisa exercitar.
          codigo_cliente_omie: existing?.codigo_cliente_omie ?? 9900 + hash(integrationCode ?? ""),
          codigo_cliente_integracao: integrationCode,
          codigo_status: "0",
          descricao_status: "Cliente processado com sucesso (mock).",
        };
      }

      case "ListarVendedores":
        return paginateFixture(request.param, [...mockSellers], {
          arrayKey: "cadastro",
          style: "snake",
        });

      case "ConsultarVendedor": {
        const omieId = numberParam(request.param, "codigo");
        const found = mockSellers.find((s) => s.codigo === omieId);
        return found ?? notFound("Vendedor");
      }

      case "ListarTabelaItens":
        return paginateFixture(request.param, [...mockPriceTableItems], {
          arrayKey: "itensTabela",
          style: "hungarian",
        });

      default:
        return null;
    }
  }
}

function notFound(entity: string): unknown {
  // Reproduz a mensagem documentada pela Omie para registro inexistente, para
  // que a classificação de erro seja exercitada de verdade.
  return {
    faultcode: "SOAP-ENV:Client-104",
    faultstring: `${entity} não cadastrado para o código informado.`,
  };
}

function numberParam(
  param: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = param[key];
  return typeof value === "number" ? value : undefined;
}

function stringParam(
  param: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = param[key];
  return typeof value === "string" ? value : undefined;
}

/** Hash determinístico simples, só para gerar ids estáveis no mock. */
function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total = (total + value.charCodeAt(i) * (i + 1)) % 90;
  }
  return total;
}

/**
 * Aplica paginação sobre uma fixture, respeitando os nomes de campo do serviço
 * correspondente — snake_case ou notação húngara.
 */
function paginateFixture(
  param: Record<string, unknown>,
  all: readonly unknown[],
  options: { arrayKey: string; style: "snake" | "hungarian" },
): Record<string, unknown> {
  const isSnake = options.style === "snake";

  const page = numberParam(param, isSnake ? "pagina" : "nPagina") ?? 1;
  const pageSize =
    numberParam(param, isSnake ? "registros_por_pagina" : "nRegPorPagina") ?? 50;

  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));

  const pagination = isSnake
    ? {
        pagina: page,
        total_de_paginas: totalPages,
        registros: items.length,
        total_de_registros: all.length,
      }
    : {
        nPagina: page,
        nTotPaginas: totalPages,
        nRegistros: items.length,
        nTotRegistros: all.length,
      };

  return { ...pagination, [options.arrayKey]: items };
}
