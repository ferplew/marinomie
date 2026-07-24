import { describe, expect, it, vi } from "vitest";
import {
  collectAllPages,
  paginate,
  PaginationCancelledError,
  type PageResult,
} from "@/integrations/omie/client/paginate";

/** Fetcher que serve uma lista fatiada, como a API real faria. */
function fetcherFor(items: number[], pageSize = 2) {
  return async ({ page }: { page: number; pageSize: number }): Promise<PageResult<number>> => {
    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    return {
      items: slice,
      page,
      totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
      totalRecords: items.length,
    };
  };
}

async function drain<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of generator) result.push(item);
  return result;
}

describe("paginate", () => {
  it("percorre todas as páginas na ordem", async () => {
    const items = await drain(paginate(fetcherFor([1, 2, 3, 4, 5]), { pageSize: 2 }));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it("retoma de uma página específica (cursor persistido)", async () => {
    const items = await drain(
      paginate(fetcherFor([1, 2, 3, 4, 5, 6]), { pageSize: 2, startPage: 2 }),
    );
    expect(items).toEqual([3, 4, 5, 6]);
  });

  it("encerra em página vazia mesmo se totalPages indicar mais", async () => {
    // Cenário real: registros removidos durante a varredura.
    const fetchPage = async ({ page }: { page: number }): Promise<PageResult<number>> =>
      page === 1
        ? { items: [1, 2], page: 1, totalPages: 5, totalRecords: 10 }
        : { items: [], page, totalPages: 5, totalRecords: 10 };

    expect(await drain(paginate(fetchPage))).toEqual([1, 2]);
  });

  it("relê totalPages a cada página, acompanhando mudanças durante a varredura", async () => {
    const fetchPage = async ({ page }: { page: number }): Promise<PageResult<number>> =>
      page === 1
        ? { items: [1], page: 1, totalPages: 3, totalRecords: 3 }
        : // O total encolheu porque registros foram removidos.
          { items: [2], page: 2, totalPages: 2, totalRecords: 2 };

    expect(await drain(paginate(fetchPage, { pageSize: 1 }))).toEqual([1, 2]);
  });

  it("respeita o teto de páginas contra resposta inconsistente", async () => {
    // A Omie sempre diz que há mais páginas: sem teto, seria laço infinito.
    const fetchPage = async ({ page }: { page: number }): Promise<PageResult<number>> => ({
      items: [page],
      page,
      totalPages: 999_999,
      totalRecords: 999_999,
    });

    const items = await drain(paginate(fetchPage, { maxPages: 4 }));
    expect(items).toEqual([1, 2, 3, 4]);
  });

  it("informa progresso para persistir o cursor", async () => {
    const onPage = vi.fn();
    await drain(paginate(fetcherFor([1, 2, 3, 4]), { pageSize: 2, onPage }));

    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage.mock.calls[1]?.[0]).toMatchObject({
      page: 2,
      itemsInPage: 2,
      itemsSoFar: 4,
      totalRecords: 4,
    });
  });

  it("suporta cancelamento", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      drain(paginate(fetcherFor([1, 2, 3]), { signal: controller.signal })),
    ).rejects.toBeInstanceOf(PaginationCancelledError);
  });

  it("permite parar no meio sem buscar as páginas restantes", async () => {
    const fetchPage = vi.fn(fetcherFor([1, 2, 3, 4, 5, 6], 2));

    for await (const item of paginate(fetchPage, { pageSize: 2 })) {
      if (item === 3) break;
    }

    // Só as duas primeiras páginas foram buscadas — é o que evita carregar todo
    // o catálogo em memória.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("lida com conjunto vazio", async () => {
    expect(await drain(paginate(fetcherFor([])))).toEqual([]);
  });
});

describe("collectAllPages", () => {
  it("coleta tudo para conjuntos pequenos", async () => {
    expect(await collectAllPages(fetcherFor([1, 2, 3], 2))).toEqual([1, 2, 3]);
  });

  it("respeita o limite rígido de itens", async () => {
    const items = await collectAllPages(fetcherFor([1, 2, 3, 4, 5, 6], 2), {
      hardLimit: 3,
    });
    expect(items).toHaveLength(3);
  });
});
