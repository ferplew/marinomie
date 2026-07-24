"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Campo de busca com debounce (briefing §22).
 *
 * O debounce de 350ms existe porque cada tecla dispararia uma navegação e uma
 * query — em celular com rede instável isso vira travamento na digitação.
 * Navega com `replace` para que a busca não empilhe entradas no histórico e o
 * botão "voltar" saia da tela, em vez de percorrer cada termo digitado.
 */
/**
 * Rotas que possuem busca. Tipar como literais (em vez de `string`) mantém a
 * verificação de `typedRoutes` valendo: apontar o campo para uma rota que não
 * existe vira erro de compilação.
 */
export type SearchableRoute = "/produtos" | "/clientes";

export function SearchField({
  action,
  placeholder,
  defaultValue = "",
  debounceMs = 350,
}: {
  action: SearchableRoute;
  placeholder: string;
  defaultValue?: string;
  debounceMs?: number;
}): React.JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Não navega na montagem: o valor inicial já veio da URL.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const trimmed = value.trim();
      router.replace(
        trimmed ? `${action}?q=${encodeURIComponent(trimmed)}` : action,
      );
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, action, debounceMs, router]);

  return (
    <div>
      <label htmlFor="search" className="sr-only">
        {placeholder}
      </label>
      <Input
        id="search"
        type="search"
        inputMode="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
