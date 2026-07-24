import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OmieClient } from "@/integrations/omie/client/omie-client";
import { OmieCircuitBreaker } from "@/integrations/omie/client/circuit-breaker";
import { OmieRateLimiter } from "@/integrations/omie/client/rate-limiter";
import {
  TransportFailure,
  type OmieTransport,
  type TransportRequest,
  type TransportResponse,
} from "@/integrations/omie/client/transport";
import { isOmieIntegrationError } from "@/integrations/omie/errors/omie-error";
import { backoffDelayMs } from "@/integrations/omie/client/backoff";

const schema = z.looseObject({ ok: z.boolean() });

const silentLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Redis mínimo em memória, suficiente para o limitador. */
function fakeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  const counters = new Map<string, number>();
  return {
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => 1,
    ...overrides,
  } as unknown as ConstructorParameters<typeof OmieRateLimiter>[0];
}

function buildClient(
  transport: OmieTransport,
  options: {
    maxAttempts?: number;
    breaker?: OmieCircuitBreaker;
    limiter?: OmieRateLimiter;
  } = {},
) {
  return new OmieClient({
    transport,
    rateLimiter: options.limiter ?? new OmieRateLimiter(fakeRedis()),
    logger: silentLogger,
    ...(options.breaker ? { circuitBreaker: options.breaker } : {}),
    ...(options.maxAttempts !== undefined
      ? { maxAttempts: options.maxAttempts }
      : {}),
    // Sem espera real nos testes.
    sleep: async () => undefined,
    random: () => 0.5,
    newCorrelationId: () => "corr-test",
  });
}

function call(client: OmieClient, overrides: Record<string, unknown> = {}) {
  return client.call({
    organizationId: "org-1",
    credentials: { appKey: "k", appSecret: "s" },
    endpoint: "geral/produtos",
    call: "ListarProdutos",
    param: {},
    schema,
    ...overrides,
  });
}

function respondWith(responses: TransportResponse[]): OmieTransport & {
  calls: TransportRequest[];
} {
  const calls: TransportRequest[] = [];
  let index = 0;
  return {
    mode: "mock",
    calls,
    async send(request) {
      calls.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (!response) throw new Error("sem resposta configurada");
      return response;
    },
  };
}

describe("OmieClient — sucesso", () => {
  it("valida a resposta contra o schema e devolve dados tipados", async () => {
    const transport = respondWith([
      { httpStatus: 200, body: { ok: true }, rawText: undefined },
    ]);
    const result = await call(buildClient(transport));
    expect(result).toEqual({ ok: true });
  });

  it("envia app_key e app_secret no corpo, nunca em cabeçalho", async () => {
    const transport = respondWith([
      { httpStatus: 200, body: { ok: true }, rawText: undefined },
    ]);
    await call(buildClient(transport));
    expect(transport.calls[0]?.appKey).toBe("k");
    expect(transport.calls[0]?.appSecret).toBe("s");
  });
});

describe("OmieClient — retry", () => {
  it("repete leitura em falha reenviável e retorna ao ter sucesso", async () => {
    const transport = respondWith([
      { httpStatus: 500, body: { faultstring: "PROTO_BYEBYE" }, rawText: undefined },
      { httpStatus: 200, body: { ok: true }, rawText: undefined },
    ]);

    const result = await call(buildClient(transport, { maxAttempts: 3 }));
    expect(result).toEqual({ ok: true });
    expect(transport.calls).toHaveLength(2);
  });

  it("respeita o limite de tentativas", async () => {
    const transport = respondWith([
      { httpStatus: 500, body: { faultstring: "PROTO_BYEBYE" }, rawText: undefined },
    ]);

    await expect(call(buildClient(transport, { maxAttempts: 3 }))).rejects.toThrow();
    expect(transport.calls).toHaveLength(3);
  });

  it("NÃO repete escrita — uma única tentativa, sempre", async () => {
    const transport = respondWith([
      { httpStatus: 500, body: { faultstring: "PROTO_BYEBYE" }, rawText: undefined },
    ]);

    await expect(
      call(buildClient(transport, { maxAttempts: 5 }), {
        call: "IncluirCliente",
      }),
    ).rejects.toMatchObject({ disposition: "UNCERTAIN_RESULT" });

    // A garantia central contra pedido duplicado.
    expect(transport.calls).toHaveLength(1);
  });

  it("não repete erro de validação, mesmo em leitura", async () => {
    const transport = respondWith([
      {
        httpStatus: 500,
        body: { faultstring: "O preenchimento da tag [x] é obrigatório" },
        rawText: undefined,
      },
    ]);

    await expect(call(buildClient(transport, { maxAttempts: 3 }))).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
    expect(transport.calls).toHaveLength(1);
  });
});

describe("OmieClient — falhas de transporte", () => {
  it("converte timeout de leitura em erro reenviável", async () => {
    const transport: OmieTransport = {
      mode: "mock",
      async send() {
        throw new TransportFailure("timeout", "estourou");
      },
    };

    await expect(call(buildClient(transport, { maxAttempts: 1 }))).rejects.toMatchObject({
      code: "TIMEOUT_ERROR",
      disposition: "RETRYABLE",
    });
  });

  it("converte timeout de escrita em resultado incerto", async () => {
    const transport: OmieTransport = {
      mode: "mock",
      async send() {
        throw new TransportFailure("timeout", "estourou");
      },
    };

    await expect(
      call(buildClient(transport), { call: "IncluirPedido" }),
    ).rejects.toMatchObject({ disposition: "UNCERTAIN_RESULT" });
  });
});

describe("OmieClient — schema divergente", () => {
  it("erro de schema exige revisão humana e não é repetido", async () => {
    const transport = respondWith([
      { httpStatus: 200, body: { ok: "não é boolean" }, rawText: undefined },
    ]);

    await expect(call(buildClient(transport, { maxAttempts: 3 }))).rejects.toMatchObject({
      code: "SCHEMA_ERROR",
      disposition: "MANUAL_REVIEW_REQUIRED",
    });
    expect(transport.calls).toHaveLength(1);
  });
});

describe("OmieClient — circuit breaker", () => {
  it("abre o circuito após falhas consecutivas e recusa sem chamar a Omie", async () => {
    const breaker = new OmieCircuitBreaker({ failureThreshold: 2, openMs: 60_000 });
    const transport: OmieTransport = {
      mode: "mock",
      async send() {
        throw new TransportFailure("network", "sem rede");
      },
    };
    const client = buildClient(transport, { maxAttempts: 1, breaker });

    await expect(call(client)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(call(client)).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    // A terceira nem chega ao transporte.
    await expect(call(client)).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
  });

  it("erro de validação não abre o circuito — a Omie está saudável", async () => {
    const breaker = new OmieCircuitBreaker({ failureThreshold: 2 });
    const transport = respondWith([
      {
        httpStatus: 500,
        body: { faultstring: "O preenchimento da tag [x] é obrigatório" },
        rawText: undefined,
      },
    ]);
    const client = buildClient(transport, { maxAttempts: 1, breaker });

    await expect(call(client)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(call(client)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(call(client)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(breaker.state("org-1")).toBe("closed");
  });

  it("sucesso zera o contador de falhas", async () => {
    const breaker = new OmieCircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure("org-1");
    breaker.recordSuccess("org-1");
    breaker.recordFailure("org-1");
    expect(breaker.state("org-1")).toBe("closed");
  });

  it("isola organizações: uma com falha não afeta a outra", () => {
    const breaker = new OmieCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure("org-1");
    expect(breaker.canAttempt("org-1")).toBe(false);
    expect(breaker.canAttempt("org-2")).toBe(true);
  });

  it("passa a half-open depois da janela", () => {
    let now = 1_000;
    const breaker = new OmieCircuitBreaker({
      failureThreshold: 1,
      openMs: 500,
      now: () => now,
    });
    breaker.recordFailure("org-1");
    expect(breaker.state("org-1")).toBe("open");
    now += 600;
    expect(breaker.state("org-1")).toBe("half-open");
    expect(breaker.canAttempt("org-1")).toBe(true);
  });
});

describe("OmieRateLimiter", () => {
  it("permite até o limite e bloqueia depois", async () => {
    const limiter = new OmieRateLimiter(fakeRedis(), { limit: 3 });
    for (let i = 0; i < 3; i += 1) {
      expect((await limiter.tryAcquire("org-1")).allowed).toBe(true);
    }
    const blocked = await limiter.tryAcquire("org-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("conta por organização", async () => {
    const limiter = new OmieRateLimiter(fakeRedis(), { limit: 1 });
    expect((await limiter.tryAcquire("org-1")).allowed).toBe(true);
    expect((await limiter.tryAcquire("org-2")).allowed).toBe(true);
  });

  it("background desiste imediatamente em vez de esperar", async () => {
    const limiter = new OmieRateLimiter(fakeRedis(), { limit: 1 });
    await limiter.tryAcquire("org-1");

    const sleep = vi.fn(async () => undefined);
    const decision = await limiter.acquire("org-1", "background", sleep);

    expect(decision.allowed).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("não deixa o Redis indisponível bloquear a operação", async () => {
    const brokenRedis = fakeRedis({
      incr: async () => {
        throw new Error("redis fora do ar");
      },
    });
    const limiter = new OmieRateLimiter(brokenRedis, { limit: 1 });
    expect((await limiter.tryAcquire("org-1")).allowed).toBe(true);
  });

  it("client devolve RATE_LIMIT_ERROR quando a janela está cheia", async () => {
    const limiter = new OmieRateLimiter(fakeRedis(), { limit: 0, maxWaitMs: 0 });
    const transport = respondWith([
      { httpStatus: 200, body: { ok: true }, rawText: undefined },
    ]);

    await expect(
      call(buildClient(transport, { limiter, maxAttempts: 1 })),
    ).rejects.toMatchObject({ code: "RATE_LIMIT_ERROR" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("backoff", () => {
  it("cresce exponencialmente", () => {
    const full = () => 1; // jitter no teto, para observar o crescimento
    expect(backoffDelayMs(1, { random: full, baseMs: 100 })).toBe(100);
    expect(backoffDelayMs(2, { random: full, baseMs: 100 })).toBe(200);
    expect(backoffDelayMs(3, { random: full, baseMs: 100 })).toBe(400);
  });

  it("respeita o teto máximo", () => {
    expect(
      backoffDelayMs(20, { random: () => 1, baseMs: 100, maxMs: 5_000 }),
    ).toBe(5_000);
  });

  it("aplica jitter: o atraso fica entre zero e o teto", () => {
    expect(backoffDelayMs(3, { random: () => 0, baseMs: 100 })).toBe(0);
    expect(backoffDelayMs(3, { random: () => 0.5, baseMs: 100 })).toBe(200);
  });
});

describe("OmieClient — erro normalizado", () => {
  it("todo erro sai como OmieIntegrationError com correlationId", async () => {
    const transport = respondWith([
      { httpStatus: 401, body: { faultstring: "app_key inválida" }, rawText: undefined },
    ]);

    try {
      await call(buildClient(transport, { maxAttempts: 1 }));
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(isOmieIntegrationError(error)).toBe(true);
      if (isOmieIntegrationError(error)) {
        expect(error.correlationId).toBe("corr-test");
        expect(error.code).toBe("AUTHENTICATION_ERROR");
        expect(error.endpoint).toBe("geral/produtos");
      }
    }
  });
});
