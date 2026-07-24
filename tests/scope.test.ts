import { describe, expect, it } from "vitest";
import { assertBelongsToOrg, orgScope, scopedWhere } from "@/server/scope";
import type { ActorContext } from "@/domain/permissions/authorize";
import type { PermissionKey } from "@/domain/permissions/catalog";
import { AppError } from "@/lib/errors";

function actor(organizationId = "org-1"): ActorContext {
  return {
    userId: "user-1",
    organizationId,
    permissions: new Set<PermissionKey>(),
    sellerLinkId: "seller-1",
    active: true,
  };
}

describe("orgScope", () => {
  it("injeta o organizationId do ator", () => {
    expect(orgScope(actor(), { active: true })).toEqual({
      active: true,
      organizationId: "org-1",
    });
  });

  it("funciona sem where inicial", () => {
    expect(orgScope(actor())).toEqual({ organizationId: "org-1" });
  });

  it("aceita organizationId redundante quando é o mesmo", () => {
    expect(orgScope(actor(), { organizationId: "org-1" })).toEqual({
      organizationId: "org-1",
    });
  });

  it("recusa tentativa de consultar outra organização", () => {
    try {
      orgScope(actor("org-1"), { organizationId: "org-2" });
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("recusa ator sem organização", () => {
    expect(() => orgScope({ organizationId: "" })).toThrow(AppError);
  });

  it("não muta o where recebido", () => {
    const where = { active: true };
    orgScope(actor(), where);
    expect(where).toEqual({ active: true });
  });
});

describe("scopedWhere", () => {
  it("não filtra por vendedor quando o escopo é total", () => {
    expect(scopedWhere(actor(), { kind: "all" }, { status: "OPEN" })).toEqual({
      status: "OPEN",
      organizationId: "org-1",
    });
  });

  it("filtra por vendedor quando o escopo é próprio", () => {
    expect(
      scopedWhere(actor(), { kind: "own", sellerLinkId: "seller-1" }, { status: "OPEN" }),
    ).toEqual({
      status: "OPEN",
      organizationId: "org-1",
      sellerLinkId: "seller-1",
    });
  });

  it("permite customizar o campo de vendedor", () => {
    expect(
      scopedWhere(actor(), { kind: "own", sellerLinkId: "seller-1" }, {}, "ownerSellerId"),
    ).toEqual({
      organizationId: "org-1",
      ownerSellerId: "seller-1",
    });
  });

  it("sempre aplica a organização, mesmo no escopo próprio", () => {
    const where = scopedWhere(actor("org-9"), { kind: "own", sellerLinkId: "s" });
    expect(where.organizationId).toBe("org-9");
  });

  it("lança quando o escopo é none", () => {
    expect(() => scopedWhere(actor(), { kind: "none" })).toThrow(AppError);
  });
});

describe("assertBelongsToOrg", () => {
  it("aceita registro da mesma organização", () => {
    expect(() => assertBelongsToOrg(actor(), { organizationId: "org-1" })).not.toThrow();
  });

  it("responde NOT_FOUND para registro de outra organização, sem confirmar existência", () => {
    try {
      assertBelongsToOrg(actor("org-1"), { organizationId: "org-2" }, "pedido");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      // NOT_FOUND em vez de FORBIDDEN: revelar "proibido" confirmaria que o ID
      // existe em outra organização.
      expect((error as AppError).code).toBe("NOT_FOUND");
    }
  });

  it("responde NOT_FOUND para registro inexistente", () => {
    try {
      assertBelongsToOrg(actor(), null, "pedido");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as AppError).code).toBe("NOT_FOUND");
    }
  });
});
