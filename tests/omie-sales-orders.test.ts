import { beforeEach, describe, expect, it } from "vitest";
import { OmieClient } from "@/integrations/omie/client/omie-client";
import { OmieRateLimiter } from "@/integrations/omie/client/rate-limiter";
import {
  MockOmieTransport,
  resetMockOrders,
} from "@/integrations/omie/mock/mock-transport";
import * as salesOrders from "@/integrations/omie/services/sales-orders.service";
import type { OmieServiceContext } from "@/integrations/omie/services/service-context";

/**
 * Pedido de venda contra o transporte mock.
 *
 * O foco é o comportamento que protege contra pedido duplicado: reenviar o
 * mesmo código de integração deve ser recusado pela Omie, e a consulta por esse
 * código deve encontrar o registro já criado.
 */
function buildContext(): OmieServiceContext {
  const counters = new Map<string, number>();
  const fakeRedis = {
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => 1,
  } as unknown as ConstructorParameters<typeof OmieRateLimiter>[0];

  return {
    client: new OmieClient({
      transport: new MockOmieTransport(),
      rateLimiter: new OmieRateLimiter(fakeRedis),
      logger: { debug: () => undefined, warn: () => undefined, error: () => undefined },
      sleep: async () => undefined,
    }),
    organizationId: "org-sales",
    credentials: { appKey: "k", appSecret: "s" },
  };
}

function baseInput(integrationCode: string) {
  return {
    integrationCode,
    customerOmieId: 9001,
    stage: "00",
    paymentTermCode: "000",
    expectedDate: "24/07/2026",
    sellerOmieId: 1001,
    items: [
      {
        productOmieId: 4001,
        itemIntegrationCode: `${integrationCode}-item-1`,
        quantity: "2",
        unitPrice: "275.00",
      },
    ],
  };
}

beforeEach(() => {
  resetMockOrders();
});

describe("createSalesDocument", () => {
  it("cria e devolve os dois identificadores distintos da Omie", async () => {
    const result = await salesOrders.createSalesDocument(
      buildContext(),
      baseInput("sd-1"),
    );

    // `codigo_pedido` (id interno) e `numero_pedido` (número visível) não são a
    // mesma coisa — confundi-los quebraria as consultas seguintes.
    expect(result.omieId).toBeGreaterThan(0);
    expect(result.omieNumber).not.toBeNull();
    expect(result.integrationCode).toBe("sd-1");
  });

  it("envia a etapa 00 para orçamento", async () => {
    const context = buildContext();
    await salesOrders.createSalesDocument(context, baseInput("sd-quote"));

    const found = await salesOrders.consultSalesDocument(context, {
      integrationCode: "sd-quote",
    });
    expect(found.stage).toBe("00");
  });

  it("recusa reenvio do mesmo código de integração — é a barreira anti-duplicidade", async () => {
    const context = buildContext();
    await salesOrders.createSalesDocument(context, baseInput("sd-dup"));

    await expect(
      salesOrders.createSalesDocument(context, baseInput("sd-dup")),
    ).rejects.toMatchObject({
      code: "CONFLICT_ERROR",
      // Conflito não é reenviável: repetir daria o mesmo erro para sempre.
      disposition: "NON_RETRYABLE",
    });
  });

  it("exige código de integração", async () => {
    await expect(
      salesOrders.createSalesDocument(buildContext(), {
        ...baseInput(""),
        integrationCode: "",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("exige ao menos um item", async () => {
    await expect(
      salesOrders.createSalesDocument(buildContext(), {
        ...baseInput("sd-empty"),
        items: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("não repete a chamada automaticamente — escrita é tentativa única", async () => {
    const context = buildContext();
    // Um conflito é NON_RETRYABLE; se houvesse retry, o segundo envio geraria
    // um segundo pedido no mock.
    await salesOrders.createSalesDocument(context, baseInput("sd-once"));
    await expect(
      salesOrders.createSalesDocument(context, baseInput("sd-once")),
    ).rejects.toThrow();

    const found = await salesOrders.consultSalesDocument(context, {
      integrationCode: "sd-once",
    });
    expect(found.omieId).not.toBeNull();
  });
});

describe("consultSalesDocument", () => {
  it("encontra pelo código de integração — o caminho de recuperação após timeout", async () => {
    const context = buildContext();
    const created = await salesOrders.createSalesDocument(
      context,
      baseInput("sd-lookup"),
    );

    const found = await salesOrders.consultSalesDocument(context, {
      integrationCode: "sd-lookup",
    });

    expect(found.omieId).toBe(created.omieId);
    expect(found.cancelled).toBe(false);
    expect(found.invoiced).toBe(false);
  });

  it("encontra pelo id interno da Omie", async () => {
    const context = buildContext();
    const created = await salesOrders.createSalesDocument(
      context,
      baseInput("sd-byid"),
    );

    const found = await salesOrders.consultSalesDocument(context, {
      omieId: created.omieId,
    });
    expect(found.integrationCode).toBe("sd-byid");
  });

  it("código de integração inexistente devolve RESOURCE_NOT_FOUND", async () => {
    // É esta resposta que permite concluir com segurança "não chegou ao Omie,
    // pode reenviar".
    await expect(
      salesOrders.consultSalesDocument(buildContext(), {
        integrationCode: "nunca-enviado",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

describe("changeSalesDocumentStage", () => {
  it("converte orçamento em pedido preservando o mesmo registro", async () => {
    const context = buildContext();
    const created = await salesOrders.createSalesDocument(
      context,
      baseInput("sd-convert"),
    );

    await salesOrders.changeSalesDocumentStage(
      context,
      { omieId: created.omieId },
      "10",
    );

    const found = await salesOrders.consultSalesDocument(context, {
      integrationCode: "sd-convert",
    });

    // Mesmo id: conversão é troca de etapa, não nova inclusão.
    expect(found.omieId).toBe(created.omieId);
    expect(found.stage).toBe("10");
  });

  it("aceita o código de integração como chave", async () => {
    const context = buildContext();
    await salesOrders.createSalesDocument(context, baseInput("sd-stage-int"));

    await salesOrders.changeSalesDocumentStage(
      context,
      { integrationCode: "sd-stage-int" },
      "20",
    );

    const found = await salesOrders.consultSalesDocument(context, {
      integrationCode: "sd-stage-int",
    });
    expect(found.stage).toBe("20");
  });

  it("falha para documento inexistente", async () => {
    await expect(
      salesOrders.changeSalesDocumentStage(
        buildContext(),
        { integrationCode: "inexistente" },
        "10",
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});
