"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { validateDocument } from "@/domain/customers/document";
import type { ActionResult } from "@/lib/errors";
import {
  createCustomerAction,
  type CreateCustomerActionData,
} from "./actions";

/**
 * Formulário de cadastro de cliente.
 *
 * A validação de CPF/CNPJ roda também aqui, para dar retorno imediato enquanto
 * o vendedor digita — mas ela é **puramente de conveniência**. A validação que
 * decide é a do servidor, que roda o mesmo módulo de domínio. Nunca confiamos
 * nesta.
 *
 * O endereço é opcional: cadastrar rápido em campo é mais importante que
 * completo. Os campos exigidos pela Omie para emissão fiscal ficam sinalizados
 * para não virar retrabalho na hora de faturar.
 */
export function CustomerForm({
  idempotencyKey,
}: {
  idempotencyKey: string;
}): React.JSX.Element {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ActionResult<CreateCustomerActionData> | null,
    FormData
  >(createCustomerAction, null);

  const [documentHint, setDocumentHint] = useState<string | null>(null);

  const fieldErrors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  function handleDocumentBlur(event: React.FocusEvent<HTMLInputElement>): void {
    const value = event.target.value.trim();
    if (value.length === 0) {
      setDocumentHint(null);
      return;
    }
    const check = validateDocument(value);
    setDocumentHint(check.valid ? `${check.type} válido` : (check.reason ?? null));
  }

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-[color:var(--color-success)]">
          Cliente cadastrado.
        </p>
        {state.data.warning && (
          <p
            role="alert"
            className="rounded-[var(--radius)] border border-[color:var(--color-warning)] p-3 text-sm"
          >
            {state.data.warning}
          </p>
        )}
        <Button type="button" onClick={() => router.push("/clientes")}>
          Voltar aos clientes
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Identificação</legend>

        <Field
          label="CPF ou CNPJ"
          htmlFor="document"
          error={fieldErrors["document"]?.[0]}
          hint={documentHint ?? "Somente números ou com pontuação."}
        >
          <Input
            id="document"
            name="document"
            inputMode="numeric"
            autoComplete="off"
            required
            onBlur={handleDocumentBlur}
          />
        </Field>

        <Field
          label="Razão social"
          htmlFor="legalName"
          error={fieldErrors["legalName"]?.[0]}
        >
          <Input id="legalName" name="legalName" required autoComplete="organization" />
        </Field>

        <Field
          label="Nome fantasia"
          htmlFor="tradeName"
          hint="Exigido pela Omie para emissão de nota fiscal."
        >
          <Input id="tradeName" name="tradeName" autoComplete="off" />
        </Field>

        <Field
          label="E-mail"
          htmlFor="email"
          error={fieldErrors["email"]?.[0]}
          hint="Exigido pela Omie para emissão de nota fiscal."
        >
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" />
        </Field>

        <Field label="Telefone" htmlFor="phone" hint="Com DDD.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">
          Endereço <span className="text-muted-foreground">(opcional)</span>
        </legend>

        <Field label="CEP" htmlFor="zipCode" error={fieldErrors["zipCode"]?.[0]}>
          <Input id="zipCode" name="zipCode" inputMode="numeric" autoComplete="postal-code" />
        </Field>

        <Field label="Logradouro" htmlFor="street">
          <Input id="street" name="street" autoComplete="address-line1" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Número" htmlFor="number">
            <Input id="number" name="number" inputMode="numeric" />
          </Field>
          <Field label="Complemento" htmlFor="complement">
            <Input id="complement" name="complement" />
          </Field>
        </div>

        <Field label="Bairro" htmlFor="district">
          <Input id="district" name="district" />
        </Field>

        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Cidade" htmlFor="city">
            <Input id="city" name="city" autoComplete="address-level2" />
          </Field>
          <Field label="UF" htmlFor="state" error={fieldErrors["state"]?.[0]}>
            <Input id="state" name="state" maxLength={2} autoComplete="address-level1" />
          </Field>
        </div>
      </fieldset>

      {state && !state.ok && !state.error.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Cadastrar cliente
      </Button>
    </form>
  );
}
