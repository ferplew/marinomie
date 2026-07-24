import { z } from "zod";

/**
 * Schemas base das respostas da Omie.
 *
 * Todos usam `z.looseObject`: campos desconhecidos são preservados em vez de
 * causarem erro. Isso é deliberado — a Omie adiciona campos às respostas sem
 * aviso, e uma listagem de produtos não deve parar de funcionar porque apareceu
 * um campo fiscal novo. O que validamos é a presença dos campos que realmente
 * usamos.
 *
 * **Nenhum nome de campo aqui foi inventado.** Cada família de paginação foi
 * confirmada na documentação do serviço correspondente — e elas diferem entre si
 * (`pagina`/`registros_por_pagina` vs. `nPagina`/`nRegPorPagina`), motivo pelo
 * qual não existe um schema único de paginação (briefing §32).
 */

/**
 * Paginação "snake_case" — confirmada em: geral/produtos, geral/clientes,
 * geral/vendedores, geral/parcelas, produtos/pedido.
 */
export const snakeCasePaginationSchema = z.object({
  pagina: z.number().int(),
  total_de_paginas: z.number().int(),
  registros: z.number().int(),
  total_de_registros: z.number().int(),
});

/**
 * Paginação "notação húngara" — confirmada em: produtos/tabelaprecos,
 * estoque/consulta (ListarPosEstoque), estoque/local.
 */
export const hungarianPaginationSchema = z.object({
  nPagina: z.number().int(),
  nTotPaginas: z.number().int(),
  nRegistros: z.number().int(),
  nTotRegistros: z.number().int(),
});

/** Forma normalizada de paginação usada internamente. */
export interface PageInfo {
  readonly page: number;
  readonly totalPages: number;
  readonly records: number;
  readonly totalRecords: number;
}

export function pageInfoFromSnakeCase(
  input: z.infer<typeof snakeCasePaginationSchema>,
): PageInfo {
  return {
    page: input.pagina,
    totalPages: input.total_de_paginas,
    records: input.registros,
    totalRecords: input.total_de_registros,
  };
}

export function pageInfoFromHungarian(
  input: z.infer<typeof hungarianPaginationSchema>,
): PageInfo {
  return {
    page: input.nPagina,
    totalPages: input.nTotPaginas,
    records: input.nRegistros,
    totalRecords: input.nTotRegistros,
  };
}

/**
 * Status de operação de escrita. Aparece com nomes diferentes por serviço; o
 * client já trata status de erro antes da validação, então aqui os campos são
 * opcionais e servem para capturar o identificador gerado.
 */
export const writeStatusSchema = z.looseObject({
  cCodStatus: z.string().optional(),
  cDesStatus: z.string().optional(),
  codigo_status: z.string().optional(),
  descricao_status: z.string().optional(),
});

/**
 * A Omie envia datas como "dd/mm/aaaa". Converte para Date, devolvendo null em
 * vez de lançar — data auxiliar malformada não deve derrubar uma listagem
 * inteira.
 */
export function parseOmieDate(value: string | undefined | null): Date | null {
  if (!value) return null;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const [, day, month, year] = match;
  if (!day || !month || !year) return null;

  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejeita datas impossíveis que o Date "corrige" silenciosamente (31/02).
  if (date.getDate() !== Number(day) || date.getMonth() !== Number(month) - 1) {
    return null;
  }
  return date;
}

/** Formata Date no padrão que a Omie espera nos filtros. */
export function formatOmieDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/** Flags "S"/"N" da Omie. */
export function omieFlagToBoolean(value: string | undefined | null): boolean {
  return value?.trim().toUpperCase() === "S";
}

export function booleanToOmieFlag(value: boolean): "S" | "N" {
  return value ? "S" : "N";
}
