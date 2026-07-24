/**
 * Fixtures do modo mock.
 *
 * Os payloads reproduzem a **estrutura documentada** de cada resposta (nomes de
 * campo, container do array, campos de paginação) — não uma estrutura inventada
 * por conveniência. É isso que dá valor ao mock: se um schema estiver errado, o
 * mock falha igual à API real falharia.
 *
 * Os dados em si são fictícios: nenhum documento pessoal real, conforme
 * briefing §29.
 */

export const mockProducts = [
  {
    codigo_produto: 4001,
    codigo_produto_integracao: "MOCK-PROD-4001",
    codigo: "CAB-2X15",
    descricao: "Cabo flexível 2,5mm² 100m",
    unidade: "RL",
    valor_unitario: 289.9,
    ncm: "85444900",
    ean: "7891234500011",
    inativo: "N",
    codigo_familia: 10,
    descricao_familia: "Elétrica",
  },
  {
    codigo_produto: 4002,
    codigo_produto_integracao: "MOCK-PROD-4002",
    codigo: "DIS-C25",
    descricao: "Disjuntor bipolar 25A",
    unidade: "UN",
    valor_unitario: 48.5,
    ncm: "85362000",
    ean: "7891234500028",
    inativo: "N",
    codigo_familia: 10,
    descricao_familia: "Elétrica",
  },
  {
    codigo_produto: 4003,
    codigo_produto_integracao: "MOCK-PROD-4003",
    codigo: "LUM-LED18",
    descricao: "Luminária LED embutir 18W",
    unidade: "UN",
    valor_unitario: 32.75,
    ncm: "94054090",
    ean: "7891234500035",
    inativo: "N",
    codigo_familia: 20,
    descricao_familia: "Iluminação",
  },
  {
    codigo_produto: 4004,
    codigo_produto_integracao: "MOCK-PROD-4004",
    codigo: "CND-25MM",
    descricao: "Conduíte corrugado 25mm 50m",
    unidade: "RL",
    valor_unitario: 74.0,
    ncm: "39172300",
    ean: "7891234500042",
    // Produto inativo de propósito: exercita o mapeamento de `inativo`.
    inativo: "S",
    codigo_familia: 10,
    descricao_familia: "Elétrica",
  },
] as const;

export const mockCustomers = [
  {
    codigo_cliente_omie: 9001,
    codigo_cliente_integracao: "MOCK-CLI-9001",
    razao_social: "Construtora Alfa Exemplo LTDA",
    nome_fantasia: "Construtora Alfa",
    // CNPJ fictício, com pontuação — exercita a normalização do mapper.
    cnpj_cpf: "11.222.333/0001-81",
    email: "compras@alfa.exemplo",
    telefone1_ddd: "11",
    telefone1_numero: "4000-0001",
    endereco: "Avenida das Amostras",
    endereco_numero: "1000",
    bairro: "Centro",
    cidade: "São Paulo",
    estado: "SP",
    cep: "01000-000",
    inativo: "N",
  },
  {
    codigo_cliente_omie: 9002,
    codigo_cliente_integracao: "MOCK-CLI-9002",
    razao_social: "Elétrica Beta Exemplo ME",
    nome_fantasia: "Elétrica Beta",
    cnpj_cpf: "44.555.666/0001-72",
    email: "contato@beta.exemplo",
    telefone1_ddd: "21",
    telefone1_numero: "4000-0002",
    endereco: "Rua de Testes",
    endereco_numero: "250",
    bairro: "Industrial",
    cidade: "Rio de Janeiro",
    estado: "RJ",
    cep: "20000-000",
    inativo: "N",
  },
] as const;

export const mockSellers = [
  {
    codigo: 1001,
    codInt: "MOCK-VEND-1001",
    nome: "Vanessa Vendedora",
    email: "vendedor1@demo.local",
    inativo: "N",
    fatura_pedido: "S",
    visualiza_pedido: "N",
    comissao: 3.5,
  },
  {
    codigo: 1002,
    codInt: "MOCK-VEND-1002",
    nome: "Victor Vendedor",
    email: "vendedor2@demo.local",
    inativo: "N",
    fatura_pedido: "N",
    visualiza_pedido: "N",
    comissao: 2.75,
  },
] as const;

export const mockWarehouses = [
  {
    codigo_local_estoque: 5001,
    codigo: "MATRIZ",
    descricao: "Depósito Matriz",
    padrao: "S",
    inativo: "N",
    dispVenda: "S",
  },
  {
    codigo_local_estoque: 5002,
    codigo: "FILIAL",
    descricao: "Depósito Filial",
    padrao: "N",
    inativo: "N",
    dispVenda: "S",
  },
] as const;

/**
 * Estoque por produto e local.
 *
 * O produto 4002 tem reservado maior que zero e disponível menor que o físico —
 * é o cenário que revela se a regra de estoque disponível está sendo aplicada, em
 * vez de simplesmente exibir o físico.
 */
export const mockStockByProduct: Record<
  number,
  ReadonlyArray<Record<string, number | string>>
> = {
  4001: [
    {
      nIdlocal: 5001,
      cDescricaoLocal: "Depósito Matriz",
      nFisico: 120,
      nReservado: 0,
      nPrevisaoSaida: 0,
      nPrevisaoEntrada: 50,
      nDisponivel: 120,
      nCMC: 210.4,
      nEstoqueMinimo: 20,
    },
    {
      nIdlocal: 5002,
      cDescricaoLocal: "Depósito Filial",
      nFisico: 15,
      nReservado: 0,
      nPrevisaoSaida: 0,
      nPrevisaoEntrada: 0,
      nDisponivel: 15,
      nCMC: 210.4,
      nEstoqueMinimo: 5,
    },
  ],
  4002: [
    {
      nIdlocal: 5001,
      cDescricaoLocal: "Depósito Matriz",
      nFisico: 80,
      nReservado: 30,
      nPrevisaoSaida: 12,
      nPrevisaoEntrada: 0,
      nDisponivel: 50,
      nCMC: 33.2,
      nEstoqueMinimo: 25,
    },
  ],
  4003: [
    {
      nIdlocal: 5001,
      cDescricaoLocal: "Depósito Matriz",
      nFisico: 4,
      nReservado: 0,
      nPrevisaoSaida: 0,
      nPrevisaoEntrada: 200,
      nDisponivel: 4,
      nCMC: 21.9,
      // Abaixo do mínimo de propósito: exercita o alerta de estoque baixo.
      nEstoqueMinimo: 30,
    },
  ],
  4004: [
    {
      nIdlocal: 5001,
      cDescricaoLocal: "Depósito Matriz",
      nFisico: 0,
      nReservado: 0,
      nPrevisaoSaida: 0,
      nPrevisaoEntrada: 0,
      nDisponivel: 0,
      nCMC: 55.0,
      nEstoqueMinimo: 10,
    },
  ],
};

export const mockPriceTableItems = [
  {
    nCodProd: 4001,
    cCodIntProd: "MOCK-PROD-4001",
    cCodigoProduto: "CAB-2X15",
    cDescricaoProduto: "Cabo flexível 2,5mm² 100m",
    nValorTabela: 275.0,
    nValorOriginal: 289.9,
    nPercDesconto: 5,
    cManual: "S",
    cTemDesconto: "S",
    nDescSugerido: 3,
    nDescMaximo: 8,
  },
  {
    nCodProd: 4002,
    cCodIntProd: "MOCK-PROD-4002",
    cCodigoProduto: "DIS-C25",
    cDescricaoProduto: "Disjuntor bipolar 25A",
    nValorTabela: 46.0,
    nValorOriginal: 48.5,
    nPercDesconto: 5,
    cManual: "N",
    cTemDesconto: "S",
    nDescSugerido: 2,
    // Teto de 4% abaixo do limite de 10% do vendedor do seed: exercita a regra
    // de "prevalece o menor dos dois".
    nDescMaximo: 4,
  },
] as const;
