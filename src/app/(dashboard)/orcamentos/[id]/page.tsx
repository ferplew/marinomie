import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/server/auth/actor";
import { hasPermission } from "@/domain/permissions/authorize";
import { getSalesDocument } from "@/domain/sales/sales.service";
import { formatDocument } from "@/domain/customers/document";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { DocumentActions } from "./document-actions";

export const metadata: Metadata = { title: "Documento de venda · marinomie" };

export default async function SalesDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireAnyPermission([
    "quotes.read_all",
    "quotes.read_own",
    "orders.read_all",
    "orders.read_own",
  ]);
  const { id } = await params;

  const document = await getSalesDocument(actor, id);
  if (!document) notFound();

  const isQuote = document.kind === "QUOTE";
  const backHref = isQuote ? "/orcamentos" : "/pedidos";

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-primary">
        ← {isQuote ? "Orçamentos" : "Pedidos"}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {isQuote ? "Orçamento" : "Pedido"} #{document.localNumber}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {document.omieNumber
              ? `Omie nº ${document.omieNumber}`
              : "ainda não enviado ao Omie"}
            {document.omieStage ? ` · etapa ${document.omieStage}` : ""}
          </p>
        </div>
        <SyncStatusBadge status={document.syncStatus} />
      </div>

      {document.status === "PENDING_APPROVAL" && (
        <p className="rounded-[var(--radius)] border border-[color:var(--color-warning)] p-3 text-sm">
          Aguardando aprovação de desconto. Não pode ser enviado ao Omie até ser
          aprovado.
        </p>
      )}

      {document.syncStatus === "CONFLICT" && (
        <p className="rounded-[var(--radius)] border border-destructive p-3 text-sm">
          O último envio não pôde ser confirmado. Use “Verificar no Omie” para
          descobrir se o pedido foi criado — <strong>não reenvie</strong>, isso
          duplicaria o registro.
        </p>
      )}

      {document.lastSyncError && document.syncStatus === "FAILED" && (
        <p className="rounded-[var(--radius)] border border-destructive p-3 text-sm">
          Falha no último envio: {document.lastSyncError}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium">
            {document.customer.tradeName || document.customer.legalName}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatDocument(document.customer.document)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vendedor: {document.sellerLink.displayName}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Itens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {document.items.map((item) => (
            <div
              key={item.id}
              className="rounded-[var(--radius)] border border-border p-3"
            >
              <p className="truncate text-sm font-medium">
                {item.product.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.product.sku ?? "sem SKU"}
              </p>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {item.quantity.toString()} × {formatCurrency(item.unitPrice.toString())}
                  {Number(item.discountPercent) > 0 && (
                    <span className="ml-1 text-xs">
                      ({item.discountPercent.toString()}% de{" "}
                      {formatCurrency(item.listUnitPrice.toString())})
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {formatCurrency(item.lineTotal.toString())}
                </span>
              </div>
              {item.priceSource && (
                <p className="mt-1 text-xs text-muted-foreground">
                  preço da origem: {item.priceSource}
                </p>
              )}
            </div>
          ))}

          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="font-medium">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(document.total.toString())}
            </span>
          </div>
        </CardContent>
      </Card>

      {document.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{document.notes}</p>
          </CardContent>
        </Card>
      )}

      <DocumentActions
        documentId={document.id}
        isQuote={isQuote}
        isSynced={document.omieId !== null}
        needsReconcile={document.syncStatus === "CONFLICT"}
        blockedByApproval={document.status === "PENDING_APPROVAL"}
        canConvert={hasPermission(actor, "quotes.convert")}
      />

      {document.attempts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de integração</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {document.attempts.map((attempt, index) => (
              <p key={index}>
                {attempt.createdAt.toLocaleString("pt-BR")} · {attempt.omieCall} ·
                tentativa {attempt.attemptNumber} · <strong>{attempt.outcome}</strong>
                {attempt.omieDescription ? ` — ${attempt.omieDescription}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
