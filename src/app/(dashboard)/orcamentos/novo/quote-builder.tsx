"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatDocument } from "@/domain/customers/document";
import {
  createQuoteAction,
  searchCustomersForCartAction,
  searchProductsForCartAction,
} from "./actions";

/**
 * Fluxo rápido de venda em etapas (briefing §22).
 *
 * Etapas em vez de um formulário gigante: cliente → produtos → revisão. O
 * resumo do total fica fixo no rodapé para o vendedor ver o valor sem rolar.
 *
 * O total exibido aqui é uma **estimativa** baseada no preço de cadastro. O
 * preço real vem da tabela aplicável e é calculado no servidor — por isso a
 * tela diz isso em vez de fingir precisão que não tem.
 */
interface CustomerOption {
  id: string;
  legalName: string;
  tradeName: string | null;
  document: string;
}

interface ProductOption {
  id: string;
  sku: string | null;
  description: string;
  unit: string | null;
  basePrice: string | null;
}

interface CartLine {
  product: ProductOption;
  quantity: string;
  discountPercent: string;
}

type Step = "customer" | "products" | "review";

export function QuoteBuilder(): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<Step>("customer");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const estimatedTotal = lines.reduce((sum, line) => {
    const price = Number(line.product.basePrice ?? "0");
    const qty = Number(line.quantity || "0");
    const discount = Number(line.discountPercent || "0");
    return sum + price * qty * (1 - discount / 100);
  }, 0);

  function handleSubmit(): void {
    setError(null);
    if (!customer || lines.length === 0) return;

    startTransition(async () => {
      const result = await createQuoteAction({
        customerId: customer.id,
        notes: notes || undefined,
        items: lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          requestedDiscountPercent: line.discountPercent || "0",
        })),
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/orcamentos/${result.data.documentId}`);
    });
  }

  return (
    <div className="space-y-4 pb-32">
      <StepIndicator current={step} />

      {step === "customer" && (
        <CustomerStep
          selected={customer}
          onSelect={(selected) => {
            setCustomer(selected);
            setStep("products");
          }}
        />
      )}

      {step === "products" && (
        <ProductStep
          lines={lines}
          onChange={setLines}
          onBack={() => setStep("customer")}
          onNext={() => setStep("review")}
        />
      )}

      {step === "review" && customer && (
        <ReviewStep
          customer={customer}
          lines={lines}
          notes={notes}
          onNotesChange={setNotes}
          onBack={() => setStep("products")}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Resumo fixo: o vendedor vê o valor sem precisar rolar a lista. */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-10 border-t border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {lines.length} item(ns) · estimativa
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {estimatedTotal.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </p>
            </div>
            {step === "review" ? (
              <Button onClick={handleSubmit} pending={pending} disabled={!customer}>
                Salvar orçamento
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setStep("review")}
                disabled={!customer || lines.length === 0}
              >
                Revisar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: Step }): React.JSX.Element {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "customer", label: "Cliente" },
    { key: "products", label: "Produtos" },
    { key: "review", label: "Revisão" },
  ];

  return (
    <ol className="flex gap-2 text-xs">
      {steps.map((item, index) => (
        <li
          key={item.key}
          className={
            item.key === current
              ? "font-medium text-primary"
              : "text-muted-foreground"
          }
        >
          {index + 1}. {item.label}
        </li>
      ))}
    </ol>
  );
}

function CustomerStep({
  selected,
  onSelect,
}: {
  selected: CustomerOption | null;
  onSelect: (customer: CustomerOption) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [searching, startSearch] = useTransition();

  function handleSearch(value: string): void {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const result = await searchCustomersForCartAction(value);
      if (result.ok) setResults([...result.data]);
    });
  }

  return (
    <div className="space-y-3">
      <Field label="Cliente" htmlFor="customer-search">
        <Input
          id="customer-search"
          type="search"
          placeholder="Nome ou documento"
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
          autoFocus
        />
      </Field>

      {selected && (
        <p className="text-sm text-muted-foreground">
          Selecionado: <strong>{selected.legalName}</strong>
        </p>
      )}

      {searching && <p className="text-sm text-muted-foreground">Buscando…</p>}

      <ul className="space-y-2">
        {results.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => onSelect(option)}
              className="w-full text-left"
            >
              <Card className="active:opacity-70">
                <CardContent className="p-3">
                  <p className="truncate font-medium">
                    {option.tradeName || option.legalName}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {formatDocument(option.document)}
                  </p>
                </CardContent>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductStep({
  lines,
  onChange,
  onBack,
  onNext,
}: {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [searching, startSearch] = useTransition();

  function handleSearch(value: string): void {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const result = await searchProductsForCartAction(value);
      if (result.ok) setResults([...result.data]);
    });
  }

  function addProduct(product: ProductOption): void {
    if (lines.some((line) => line.product.id === product.id)) return;
    onChange([...lines, { product, quantity: "1", discountPercent: "0" }]);
    setQuery("");
    setResults([]);
  }

  function updateLine(productId: string, patch: Partial<CartLine>): void {
    onChange(
      lines.map((line) =>
        line.product.id === productId ? { ...line, ...patch } : line,
      ),
    );
  }

  return (
    <div className="space-y-3">
      <Field label="Adicionar produto" htmlFor="product-search">
        <Input
          id="product-search"
          type="search"
          placeholder="SKU ou descrição"
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
        />
      </Field>

      {searching && <p className="text-sm text-muted-foreground">Buscando…</p>}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => addProduct(product)}
                className="w-full text-left"
              >
                <Card className="active:opacity-70">
                  <CardContent className="p-3">
                    <p className="truncate font-medium">{product.description}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {product.sku ?? "sem SKU"}
                    </p>
                  </CardContent>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Itens do orçamento</h2>
          {lines.map((line) => (
            <Card key={line.product.id}>
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {line.product.description}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(lines.filter((l) => l.product.id !== line.product.id))
                    }
                    className="shrink-0 text-xs text-destructive"
                  >
                    remover
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Quantidade" htmlFor={`qty-${line.product.id}`}>
                    <Input
                      id={`qty-${line.product.id}`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.product.id, { quantity: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Desconto %" htmlFor={`disc-${line.product.id}`}>
                    <Input
                      id={`disc-${line.product.id}`}
                      inputMode="decimal"
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(line.product.id, {
                          discountPercent: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>
          ← Cliente
        </Button>
        <Button
          variant="secondary"
          onClick={onNext}
          disabled={lines.length === 0}
        >
          Revisar →
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  customer,
  lines,
  notes,
  onNotesChange,
  onBack,
}: {
  customer: CustomerOption;
  lines: CartLine[];
  notes: string;
  onNotesChange: (value: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Cliente</p>
          <p className="font-medium">{customer.legalName}</p>
          <p className="text-sm text-muted-foreground">
            {formatDocument(customer.document)}
          </p>
        </CardContent>
      </Card>

      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.product.id}>
            <Card>
              <CardContent className="p-3">
                <p className="truncate text-sm font-medium">
                  {line.product.description}
                </p>
                <p className="text-sm text-muted-foreground">
                  {line.quantity} {line.product.unit ?? "un"}
                  {Number(line.discountPercent) > 0
                    ? ` · ${line.discountPercent}% de desconto`
                    : ""}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Field label="Observações" htmlFor="notes">
        <Input
          id="notes"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          maxLength={500}
        />
      </Field>

      <p className="text-xs text-muted-foreground">
        O preço final é calculado no servidor pela tabela de preço aplicável ao
        cliente. O valor no rodapé é uma estimativa pelo preço de cadastro.
      </p>

      <Button variant="ghost" onClick={onBack}>
        ← Produtos
      </Button>
    </div>
  );
}
