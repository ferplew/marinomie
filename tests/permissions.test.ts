import { describe, expect, it } from "vitest";
import {
  assertPermission,
  assertReadScope,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  resolveReadScope,
  resolveSellerForWrite,
  visibleStockFields,
  type ActorContext,
} from "@/domain/permissions/authorize";
import { PERMISSIONS, isPermissionKey, type PermissionKey } from "@/domain/permissions/catalog";
import { DEFAULT_ROLE_PERMISSIONS } from "@/domain/permissions/roles";
import { AppError } from "@/lib/errors";

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: "user-1",
    organizationId: "org-1",
    permissions: new Set<PermissionKey>(),
    sellerLinkId: null,
    active: true,
    ...overrides,
  };
}

function withPermissions(...permissions: PermissionKey[]): ActorContext {
  return actor({ permissions: new Set(permissions) });
}

describe("catálogo de permissões", () => {
  it("não tem chaves duplicadas", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("reconhece apenas chaves do catálogo", () => {
    expect(isPermissionKey("orders.create")).toBe(true);
    expect(isPermissionKey("orders.delete_everything")).toBe(false);
  });

  it("dá ao SUPER_ADMIN todas as permissões do catálogo", () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(new Set(PERMISSIONS));
  });

  it("só atribui aos perfis padrão permissões que existem no catálogo", () => {
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const key of keys) {
        expect(isPermissionKey(key), `${role} usa permissão inexistente: ${key}`).toBe(true);
      }
    }
  });

  it("não concede ao VENDEDOR permissões que ele nunca deve ter", () => {
    const proibidas: PermissionKey[] = [
      "products.view_cost",
      "customers.read_all",
      "orders.read_all",
      "discounts.approve",
      "prices.override",
      "orders.create_on_behalf",
      "integrations.configure",
      "audit.read",
    ];
    for (const key of proibidas) {
      expect(DEFAULT_ROLE_PERMISSIONS.VENDEDOR).not.toContain(key);
    }
  });

  it("dá ao perfil CONSULTA apenas permissões de leitura", () => {
    for (const key of DEFAULT_ROLE_PERMISSIONS.CONSULTA) {
      expect(key).toMatch(/\.(read|read_own|read_all)$/);
    }
  });
});

describe("hasPermission", () => {
  it("concede quando a permissão está presente", () => {
    expect(hasPermission(withPermissions("orders.create"), "orders.create")).toBe(true);
  });

  it("nega quando a permissão está ausente", () => {
    expect(hasPermission(withPermissions("orders.read_own"), "orders.create")).toBe(false);
  });

  it("nega tudo para usuário inativo, mesmo com a permissão", () => {
    const inativo = actor({
      permissions: new Set<PermissionKey>(["orders.create"]),
      active: false,
    });
    expect(hasPermission(inativo, "orders.create")).toBe(false);
  });

  it("hasAny exige ao menos uma; hasAll exige todas", () => {
    const a = withPermissions("quotes.create");
    expect(hasAnyPermission(a, ["quotes.create", "orders.create"])).toBe(true);
    expect(hasAllPermissions(a, ["quotes.create", "orders.create"])).toBe(false);
  });
});

describe("assertPermission", () => {
  it("passa silenciosamente quando autorizado", () => {
    expect(() => assertPermission(withPermissions("audit.read"), "audit.read")).not.toThrow();
  });

  it("lança FORBIDDEN quando a permissão falta", () => {
    try {
      assertPermission(actor(), "audit.read");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("lança FORBIDDEN para usuário inativo", () => {
    const inativo = actor({ permissions: new Set<PermissionKey>(["audit.read"]), active: false });
    expect(() => assertPermission(inativo, "audit.read")).toThrow(AppError);
  });

  it("não vaza a permissão exigida na mensagem exibida ao usuário", () => {
    try {
      assertPermission(actor(), "products.view_cost");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.message).toContain("products.view_cost"); // log interno
      expect(appError.userMessage).not.toContain("products.view_cost"); // usuário
    }
  });
});

describe("resolveReadScope", () => {
  it("devolve escopo total com a permissão _all", () => {
    const a = withPermissions("orders.read_all");
    expect(resolveReadScope(a, "orders")).toEqual({ kind: "all" });
  });

  it("devolve escopo próprio com _own e vínculo de vendedor", () => {
    const a = actor({
      permissions: new Set<PermissionKey>(["orders.read_own"]),
      sellerLinkId: "seller-1",
    });
    expect(resolveReadScope(a, "orders")).toEqual({ kind: "own", sellerLinkId: "seller-1" });
  });

  it("prefere _all quando o usuário tem as duas", () => {
    const a = actor({
      permissions: new Set<PermissionKey>(["orders.read_own", "orders.read_all"]),
      sellerLinkId: "seller-1",
    });
    expect(resolveReadScope(a, "orders")).toEqual({ kind: "all" });
  });

  it("não vira acesso amplo quando há _own sem vínculo de vendedor", () => {
    const a = withPermissions("orders.read_own");
    expect(resolveReadScope(a, "orders")).toEqual({ kind: "none" });
  });

  it("nega sem nenhuma permissão de leitura", () => {
    expect(resolveReadScope(actor(), "customers")).toEqual({ kind: "none" });
  });

  it("isola recursos entre si: ler pedidos não permite ler clientes", () => {
    const a = withPermissions("orders.read_all");
    expect(resolveReadScope(a, "customers")).toEqual({ kind: "none" });
  });

  it("assertReadScope lança quando o escopo é none", () => {
    expect(() => assertReadScope(actor(), "quotes")).toThrow(AppError);
  });
});

describe("resolveSellerForWrite", () => {
  it("usa o vínculo do próprio usuário por padrão", () => {
    const a = actor({ sellerLinkId: "seller-1" });
    expect(resolveSellerForWrite(a)).toEqual({ sellerLinkId: "seller-1", onBehalf: false });
  });

  it("ignora o vendedor enviado quando é o próprio do usuário", () => {
    const a = actor({ sellerLinkId: "seller-1" });
    expect(resolveSellerForWrite(a, "seller-1")).toEqual({
      sellerLinkId: "seller-1",
      onBehalf: false,
    });
  });

  it("recusa criar em nome de outro vendedor sem a permissão", () => {
    const a = actor({ sellerLinkId: "seller-1" });
    try {
      resolveSellerForWrite(a, "seller-2");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("permite em nome de outro vendedor com orders.create_on_behalf", () => {
    const a = actor({
      sellerLinkId: "seller-1",
      permissions: new Set<PermissionKey>(["orders.create_on_behalf"]),
    });
    expect(resolveSellerForWrite(a, "seller-2")).toEqual({
      sellerLinkId: "seller-2",
      onBehalf: true,
    });
  });

  it("recusa quando o usuário não tem vendedor vinculado", () => {
    expect(() => resolveSellerForWrite(actor())).toThrow(AppError);
  });
});

describe("visibleStockFields", () => {
  it("esconde todos os campos sensíveis por padrão", () => {
    expect(visibleStockFields(actor())).toEqual({
      physical: false,
      reserved: false,
      cost: false,
    });
  });

  it("revela apenas os campos permitidos, um a um", () => {
    const a = withPermissions("products.view_physical_stock");
    expect(visibleStockFields(a)).toEqual({
      physical: true,
      reserved: false,
      cost: false,
    });
  });

  it("esconde tudo de usuário inativo", () => {
    const inativo = actor({
      permissions: new Set<PermissionKey>([
        "products.view_cost",
        "products.view_physical_stock",
        "products.view_reserved_stock",
      ]),
      active: false,
    });
    expect(visibleStockFields(inativo)).toEqual({
      physical: false,
      reserved: false,
      cost: false,
    });
  });
});
