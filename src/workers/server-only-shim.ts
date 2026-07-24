/**
 * Substituto de `server-only` para o processo de workers.
 *
 * O pacote real lança ao ser importado fora do runtime do Next, porque detecta
 * a ausência da condição `react-server`. Só que um worker **é** código de
 * servidor — a intenção do `server-only` (nunca entrar no bundle do navegador)
 * continua satisfeita.
 *
 * O alias vale apenas para `tsconfig.worker.json`. No build do Next, o pacote
 * real continua ativo e a proteção segue valendo.
 */
export {};
