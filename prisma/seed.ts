/**
 * Seed de desenvolvimento (briefing §29).
 *
 * Cria uma organização, os perfis padrão e usuários de demonstração.
 * Não inclui documentos pessoais reais — CNPJ e nomes são fictícios.
 *
 * Clientes, produtos, tabelas de preço, orçamentos e pedidos entram no seed na
 * Fase 5, junto com as entidades correspondentes.
 *
 * As senhas de demonstração são fixas e óbvias de propósito: este seed é para
 * desenvolvimento local e NUNCA deve ser executado em produção (ver guarda no
 * início de `main`).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PERMISSIONS } from "../src/domain/permissions/catalog";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  type DefaultRoleName,
} from "../src/domain/permissions/roles";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL não definida.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_PASSWORD = "senha-de-desenvolvimento";

/**
 * Gera o hash no mesmo formato que o Better Auth usa (scrypt), para que os
 * usuários do seed consigam de fato entrar pela tela de login.
 */
async function hashPassword(password: string): Promise<string> {
  const { hashPassword: betterAuthHash } = await import("better-auth/crypto");
  return betterAuthHash(password);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("O seed de demonstração não pode rodar em produção.");
  }

  // 1. Catálogo global de permissões, derivado do código-fonte.
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }
  console.log(`✓ ${PERMISSIONS.length} permissões`);

  // 2. Organização de demonstração.
  const organization = await prisma.organization.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Marin Distribuidora (demonstração)",
      document: "11222333000181", // CNPJ fictício
    },
  });

  await prisma.organizationSettings.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id },
  });
  console.log(`✓ organização ${organization.name}`);

  // 3. Perfis padrão com suas permissões.
  const roleIds = new Map<DefaultRoleName, string>();

  for (const [roleName, permissionKeys] of Object.entries(
    DEFAULT_ROLE_PERMISSIONS,
  ) as [DefaultRoleName, readonly string[]][]) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: roleName } },
      update: { description: ROLE_DESCRIPTIONS[roleName] },
      create: {
        organizationId: organization.id,
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
        isSystem: true,
      },
    });
    roleIds.set(roleName, role.id);

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...permissionKeys] } },
      select: { id: true },
    });

    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`✓ ${roleIds.size} perfis`);

  // 4. Usuários de demonstração.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const demoUsers = [
    { email: "admin@demo.local", name: "Ana Administradora", role: "ADMIN" as const },
    { email: "gerente@demo.local", name: "Gabriel Gerente", role: "GERENTE_COMERCIAL" as const },
    { email: "vendedor1@demo.local", name: "Vanessa Vendedora", role: "VENDEDOR" as const, omieSellerId: 1001 },
    { email: "vendedor2@demo.local", name: "Victor Vendedor", role: "VENDEDOR" as const, omieSellerId: 1002 },
  ];

  for (const demo of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: {
        email: demo.email,
        name: demo.name,
        emailVerified: true,
        organizationId: organization.id,
      },
    });

    await prisma.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: user.id },
      },
      update: { password: passwordHash },
      create: {
        providerId: "credential",
        accountId: user.id,
        userId: user.id,
        password: passwordHash,
      },
    });

    const roleId = roleIds.get(demo.role);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
    }

    if (demo.omieSellerId) {
      await prisma.sellerLink.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          organizationId: organization.id,
          userId: user.id,
          omieSellerId: demo.omieSellerId,
          displayName: demo.name,
          maxDiscountPercent: 10,
        },
      });
    }
  }
  console.log(`✓ ${demoUsers.length} usuários (senha: ${DEMO_PASSWORD})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Falha no seed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
