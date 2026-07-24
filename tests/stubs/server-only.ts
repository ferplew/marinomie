/**
 * Stub de `server-only` para o Vitest.
 *
 * O pacote real lança ao ser importado fora de um Server Component, o que impede
 * testar módulos de servidor (criptografia, credenciais) em processo Node puro.
 * O alias é aplicado apenas em `vitest.config.ts` — a proteção real continua
 * valendo no build do Next, que é onde ela importa.
 */
export {};
