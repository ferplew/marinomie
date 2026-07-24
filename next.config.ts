import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança aplicados a todas as respostas (docs/security.md §7).
 * CSP é intencionalmente restritiva; `unsafe-inline` em style-src é necessário
 * enquanto usarmos estilos inline do Next/Tailwind em runtime.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Habilita forbidden()/unauthorized(), usados pelas guardas de permissão.
    // Sem isso, uma falta de permissão vira HTTP 500 em vez de 403.
    authInterrupts: true,
  },
  // O client da Omie e o Prisma nunca devem ser incluídos no bundle do cliente.
  serverExternalPackages: ["@prisma/client", "pino", "ioredis"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
