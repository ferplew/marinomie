"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import type { ActionResult } from "@/lib/errors";
import { saveCredentialsAction, testConnectionAction } from "./actions";

/**
 * Formulário de credenciais da Omie.
 *
 * Os campos são sempre enviados vazios de volta: o servidor nunca devolve o
 * valor salvo, nem mascarado. Para trocar a credencial, o administrador digita
 * de novo — é o comportamento correto para um segredo que só deve existir
 * cifrado no banco.
 */
export function CredentialForm({
  hasCredential,
}: {
  hasCredential: boolean;
}): React.JSX.Element {
  const [state, formAction, saving] = useActionState<
    ActionResult<{ appKeyHint: string }> | null,
    FormData
  >(saveCredentialsAction, null);

  const fieldErrors =
    state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="app_key"
        htmlFor="appKey"
        error={fieldErrors["appKey"]?.[0]}
        hint="Obtida no portal do desenvolvedor Omie, na tela do aplicativo."
      >
        <Input
          id="appKey"
          name="appKey"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>

      <Field
        label="app_secret"
        htmlFor="appSecret"
        error={fieldErrors["appSecret"]?.[0]}
        hint="Fica cifrado no banco e nunca é exibido de volta."
      >
        <Input
          id="appSecret"
          name="appSecret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>

      {state?.ok && (
        <p role="status" className="text-sm text-[color:var(--color-success)]">
          Credencial salva (***{state.data.appKeyHint}). Teste a conexão para
          confirmar.
        </p>
      )}

      {state && !state.ok && !state.error.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={saving}>
          {hasCredential ? "Substituir credencial" : "Salvar credencial"}
        </Button>
        <TestConnectionButton />
      </div>
    </form>
  );
}

function TestConnectionButton(): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  function handleTest(): void {
    setResult(null);
    startTransition(async () => {
      const response = await testConnectionAction();
      setResult(
        response.ok
          ? { ok: true, message: response.data.detail }
          : { ok: false, message: response.error.message },
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleTest}
        pending={pending}
      >
        Testar conexão
      </Button>
      {result && (
        <p
          role="status"
          className={
            result.ok
              ? "text-sm text-[color:var(--color-success)]"
              : "text-sm text-destructive"
          }
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
