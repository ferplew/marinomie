/**
 * Utilitário de paginação (briefing §32).
 *
 * Deliberadamente **não** assume nomes de campo: cada serviço da Omie pagina com
 * uma nomenclatura própria (`pagina`/`registros_por_pagina` em produtos e
 * clientes, `nPagina`/`nRegPorPagina` em tabelas de preço e estoque). O adapter
 * de cada service traduz sua resposta para `PageResult`, e este utilitário só
 * cuida do laço.
 *
 * Garantias oferecidas:
 * - itera páginas sem carregar tudo em memória (é um gerador assíncrono);
 * - permite retomar de uma página específica (cursor persistido em `SyncJob`);
 * - suporta cancelamento via `AbortSignal`;
 * - tem teto de páginas para que uma resposta inconsistente da Omie não vire
 *   laço infinito;
 * - lida com página vazia mesmo quando `totalPages` diz que ainda há conteúdo.
 */

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalRecords: number;
}

export interface PaginateOptions {
  /** Página inicial (1-based). Usado para retomar sincronização interrompida. */
  readonly startPage?: number;
  readonly pageSize?: number;
  /** Teto de segurança contra resposta inconsistente. */
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
  /** Chamado ao fim de cada página — usado para persistir o cursor. */
  readonly onPage?: (progress: PaginationProgress) => Promise<void> | void;
}

export interface PaginationProgress {
  readonly page: number;
  readonly totalPages: number;
  readonly totalRecords: number;
  readonly itemsInPage: number;
  readonly itemsSoFar: number;
}

export const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 2_000;

export type PageFetcher<T> = (params: {
  page: number;
  pageSize: number;
}) => Promise<PageResult<T>>;

export class PaginationCancelledError extends Error {
  constructor() {
    super("Paginação cancelada");
    this.name = "PaginationCancelledError";
  }
}

/**
 * Itera todas as páginas, entregando item por item.
 *
 * O consumidor decide quando parar (`break`), o que permite processar em lotes
 * sem acumular o resultado inteiro.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let page = options.startPage ?? 1;
  let itemsSoFar = 0;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    if (options.signal?.aborted) throw new PaginationCancelledError();

    const result = await fetchPage({ page, pageSize });
    pagesFetched += 1;

    for (const item of result.items) {
      yield item;
    }
    itemsSoFar += result.items.length;

    await options.onPage?.({
      page: result.page,
      totalPages: result.totalPages,
      totalRecords: result.totalRecords,
      itemsInPage: result.items.length,
      itemsSoFar,
    });

    // Página vazia encerra a iteração mesmo que totalPages sugira mais: é o que
    // acontece quando registros são removidos durante a paginação.
    if (result.items.length === 0) return;

    // `totalPages` pode mudar entre chamadas se dados forem alterados durante a
    // varredura — por isso relemos o valor da resposta a cada página em vez de
    // calcular o total uma única vez no início.
    if (result.page >= result.totalPages) return;

    page = result.page + 1;
  }
}

/**
 * Coleta todas as páginas numa lista.
 *
 * Use apenas para conjuntos pequenos e limitados (locais de estoque,
 * vendedores). Para catálogo e clientes, use `paginate` e processe em lotes —
 * carregar tudo em memória é justamente o que o briefing §12 proíbe.
 */
export async function collectAllPages<T>(
  fetchPage: PageFetcher<T>,
  options: PaginateOptions & { readonly hardLimit?: number } = {},
): Promise<T[]> {
  const hardLimit = options.hardLimit ?? 5_000;
  const items: T[] = [];

  for await (const item of paginate(fetchPage, options)) {
    items.push(item);
    if (items.length >= hardLimit) break;
  }

  return items;
}
