import { describe, expect, it } from "vitest";
import { OmieClient } from "@/integrations/omie/client/omie-client";
import { OmieRateLimiter } from "@/integrations/omie/client/rate-limiter";
import { MockOmieTransport } from "@/integrations/omie/mock/mock-transport";
import * as productsService from "@/integrations/omie/services/products.service";
import * as inventoryService from "@/integrations/omie/services/inventory.service";
import * as customersService from "@/integrations/omie/services/customers.service";
import * as sellersService from "@/integrations/omie/services/sellers.service";
import * as priceTablesService from "@/integrations/omie/services/price-tables.service";
import * as connectionService from "@/integrations/omie/services/connection.service";
import { collectAllPages } from "@/integrations/omie/client/paginate";
import type { OmieServiceContext } from "@/integrations/omie/services/service-context";

/**
 * Teste de integração do caminho completo, com o transporte mock.
 *
 * O valor deste arquivo é validar a cadeia inteira — client, schema Zod, mapper,
 * service, paginação — contra payloads que reproduzem a estrutura documentada da
 * Omie. Um schema errado quebra aqui, exatamente como quebraria em produção.
 */
function buildContext(
  overrides: Partial<{ appKey: string; appSecret: string }> = {},
): OmieServiceContext {
  const counters = new Map<string, number>();
  const fakeRedis = {
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => 1,
  } as unknown as ConstructorParameters<typeof OmieRateLimiter>[0];

  const client = new OmieClient({
    transport: new MockOmieTransport(),
    rateLimiter: new OmieRateLimiter(fakeRedis),
    logger: {
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    sleep: async () => undefined,
  });

  return {
    client,
    organizationId: "org-mock",
    credentials: {
      appKey: overrides.appKey ?? "mock-app-key",
      appSecret: overrides.appSecret ?? "mock-app-secret",
    },
  };
}

describe("produtos via mock", () => {
  it("lista produtos e devolve DTOs, não o formato da Omie", async () => {
    const page = await productsService.listProducts(buildContext(), { page: 1 });

    expect(page.totalRecords).toBeGreaterThan(0);
    const first = page.items[0];
    expect(first).toBeDefined();
    expect(first).toHaveProperty("omieId");
    expect(first).not.toHaveProperty("codigo_produto");
  });

  it("mapeia produto inativo corretamente ponta a ponta", async () => {
    const page = await productsService.listProducts(buildContext(), {
      page: 1,
      pageSize: 100,
    });
    const inactive = page.items.find((p) => p.sku === "CND-25MM");
    expect(inactive?.active).toBe(false);
  });

  it("pagina de verdade: página 2 traz itens diferentes da página 1", async () => {
    const context = buildContext();
    const first = await productsService.listProducts(context, {
      page: 1,
      pageSize: 2,
    });
    const second = await productsService.listProducts(context, {
      page: 2,
      pageSize: 2,
    });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.items[0]?.omieId).not.toBe(second.items[0]?.omieId);
  });

  it("o utilitário de paginação percorre todas as páginas", async () => {
    const context = buildContext();
    const all = await collectAllPages(
      async ({ page, pageSize }) =>
        productsService.listProducts(context, { page, pageSize }),
      { pageSize: 2 },
    );

    expect(all).toHaveLength(4);
    expect(new Set(all.map((p) => p.omieId)).size).toBe(4);
  });

  it("listagem resumida devolve o DTO reduzido", async () => {
    const page = await productsService.listProductsSummary(buildContext(), {
      page: 1,
    });
    expect(page.items[0]).not.toHaveProperty("unit");
    expect(page.items[0]).toHaveProperty("basePrice");
  });

  it("consulta produto por SKU", async () => {
    const product = await productsService.consultProduct(buildContext(), {
      sku: "DIS-C25",
    });
    expect(product.omieId).toBe(4002);
  });

  it("produto inexistente vira RESOURCE_NOT_FOUND, não erro genérico", async () => {
    await expect(
      productsService.consultProduct(buildContext(), { sku: "NAO-EXISTE" }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

describe("estoque via mock", () => {
  it("devolve posição por local com componentes separados", async () => {
    const stock = await inventoryService.getProductStock(buildContext(), {
      omieId: 4002,
    });

    const position = stock.positions[0];
    expect(position?.physical).toBe("80");
    expect(position?.reserved).toBe("30");
    expect(position?.omieAvailable).toBe("50");
    expect(position?.warehouseOmieId).toBe(5001);
  });

  it("produto com dois depósitos devolve duas posições", async () => {
    const stock = await inventoryService.getProductStock(buildContext(), {
      omieId: 4001,
    });
    expect(stock.positions).toHaveLength(2);
  });

  it("registra o momento da leitura", async () => {
    const before = Date.now();
    const stock = await inventoryService.getProductStock(buildContext(), {
      omieId: 4001,
    });
    expect(stock.readAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("lista locais de estoque (paginação em notação húngara)", async () => {
    const page = await inventoryService.listWarehouses(buildContext(), {
      page: 1,
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.isDefault).toBe(true);
  });
});

describe("clientes via mock", () => {
  it("lista clientes normalizando documento", async () => {
    const page = await customersService.listCustomers(buildContext(), {
      page: 1,
    });
    expect(page.items[0]?.document).toBe("11222333000181");
  });

  it("listagem resumida usa `codigo_cliente` e ainda produz o mesmo DTO", async () => {
    const page = await customersService.listCustomersSummary(buildContext(), {
      page: 1,
    });
    expect(page.items[0]?.omieId).toBe(9001);
  });

  it("upsert por documento reaproveita o id quando o cliente já existe", async () => {
    // É o comportamento que impede criar cliente duplicado quando ele já foi
    // cadastrado direto no ERP.
    const result = await customersService.upsertCustomerByDocument(
      buildContext(),
      {
        integrationCode: "LOCAL-UUID-1",
        legalName: "Construtora Alfa Exemplo LTDA",
        document: "11222333000181",
        tradeName: "Construtora Alfa",
        email: "compras@alfa.exemplo",
      },
    );

    expect(result.omieId).toBe(9001);
    expect(result.integrationCode).toBe("LOCAL-UUID-1");
  });

  it("cliente novo recebe id novo", async () => {
    const result = await customersService.upsertCustomerByDocument(
      buildContext(),
      {
        integrationCode: "LOCAL-UUID-2",
        legalName: "Empresa Nova Exemplo",
        document: "99888777000166",
        tradeName: "Nova",
        email: "novo@exemplo",
      },
    );

    expect(result.omieId).toBeGreaterThan(0);
    expect(result.omieId).not.toBe(9001);
  });
});

describe("vendedores e tabelas via mock", () => {
  it("lista vendedores a partir do array `cadastro`", async () => {
    const page = await sellersService.listSellers(buildContext(), { page: 1 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.omieId).toBe(1001);
    expect(page.items[0]?.canInvoiceOrder).toBe(true);
  });

  it("lista itens de tabela de preço com desconto máximo", async () => {
    const page = await priceTablesService.listPriceTableItems(buildContext(), {
      page: 1,
      priceTableOmieId: 1,
    });
    const item = page.items.find((i) => i.sku === "DIS-C25");
    expect(item?.maxDiscountPercent).toBe("4");
  });

  it("exige identificar a tabela antes de chamar a Omie", async () => {
    await expect(
      priceTablesService.listPriceTableItems(buildContext(), { page: 1 }),
    ).rejects.toThrow(/priceTableOmieId/);
  });
});

describe("teste de conexão", () => {
  it("reporta sucesso com credenciais válidas", async () => {
    const result = await connectionService.testConnection(buildContext());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sellersFound).toBe(2);
  });

  it("reporta falha de autenticação com credencial vazia, sem vazar detalhe interno", async () => {
    const result = await connectionService.testConnection(
      buildContext({ appKey: "", appSecret: "" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUTHENTICATION_ERROR");
      expect(result.detail).toContain("Credenciais recusadas");
      expect(result.detail).not.toContain("stack");
    }
  });
});

describe("mock recusa método não implementado", () => {
  it("não devolve sucesso silencioso para chamada desconhecida", async () => {
    const context = buildContext();
    const { z } = await import("zod");

    await expect(
      context.client.call({
        organizationId: "org-mock",
        credentials: context.credentials,
        endpoint: "geral/qualquer",
        call: "MetodoInexistente",
        param: {},
        schema: z.looseObject({}),
      }),
    ).rejects.toThrow();
  });
});
