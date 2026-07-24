/**
 * DTOs da integração — a fronteira entre a Omie e o nosso domínio.
 *
 * Regra do briefing §5: "o frontend não deve conhecer o formato original das
 * respostas da Omie". Estes tipos são o que sai de `src/integrations/omie`;
 * nenhum `codigo_produto` ou `nFisico` atravessa essa linha.
 *
 * Valores monetários e quantidades trafegam como `string` porque o Prisma usa
 * `Decimal` e a conversão para `number` aqui introduziria erro de ponto
 * flutuante justamente em preço e estoque (briefing §18: "evite armazenar
 * dinheiro em float").
 */

export interface ProductDTO {
  readonly omieId: number;
  readonly integrationCode: string | null;
  readonly sku: string | null;
  readonly description: string;
  readonly unit: string | null;
  readonly ncm: string | null;
  readonly ean: string | null;
  readonly basePrice: string | null;
  readonly active: boolean;
  readonly familyOmieId: number | null;
  readonly familyName: string | null;
}

export interface ProductSummaryDTO {
  readonly omieId: number;
  readonly integrationCode: string | null;
  readonly sku: string | null;
  readonly description: string;
  readonly basePrice: string | null;
}

/**
 * Posição de estoque por local.
 *
 * `omieAvailable` é o `nDisponivel` que a própria Omie calcula, e vem separado
 * dos componentes brutos justamente para que a regra `AvailableStockRule` da
 * organização possa escolher entre confiar nele ou recalcular localmente — sem
 * que o mapper decida isso por conta própria.
 */
export interface StockPositionDTO {
  readonly warehouseOmieId: number | null;
  readonly warehouseName: string | null;
  readonly physical: string | null;
  readonly reserved: string | null;
  readonly expectedOut: string | null;
  readonly expectedIn: string | null;
  readonly omieAvailable: string | null;
  readonly minStock: string | null;
  readonly averageCost: string | null;
}

export interface ProductStockDTO {
  readonly productOmieId: number;
  readonly sku: string | null;
  readonly description: string | null;
  readonly unit: string | null;
  readonly positions: readonly StockPositionDTO[];
  /** Momento da leitura — alimenta o indicador de dado desatualizado na UI. */
  readonly readAt: Date;
}

export interface WarehouseDTO {
  readonly omieId: number;
  readonly code: string | null;
  readonly name: string | null;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly availableForSale: boolean;
}

export interface CustomerDTO {
  readonly omieId: number;
  readonly integrationCode: string | null;
  readonly document: string | null;
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly active: boolean;
  readonly address: CustomerAddressDTO | null;
}

export interface CustomerAddressDTO {
  readonly street: string | null;
  readonly number: string | null;
  readonly complement: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zipCode: string | null;
}

export interface CustomerSummaryDTO {
  readonly omieId: number;
  readonly integrationCode: string | null;
  readonly document: string | null;
  readonly legalName: string | null;
  readonly tradeName: string | null;
}

export interface SellerDTO {
  readonly omieId: number;
  readonly integrationCode: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly active: boolean;
  readonly canInvoiceOrder: boolean;
  readonly viewOnlyOrders: boolean;
  readonly commissionPercent: string | null;
}

export interface PriceTableItemDTO {
  readonly productOmieId: number | null;
  readonly productIntegrationCode: string | null;
  readonly sku: string | null;
  readonly description: string | null;
  readonly tablePrice: string | null;
  readonly suggestedDiscountPercent: string | null;
  /** Teto de desconto vindo da Omie. Combina com o limite do vendedor. */
  readonly maxDiscountPercent: string | null;
  readonly manuallyAdjusted: boolean;
}

/** Página normalizada — o formato interno é o mesmo para todos os serviços. */
export interface OmiePage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalRecords: number;
}
