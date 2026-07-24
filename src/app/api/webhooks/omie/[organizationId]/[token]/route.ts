import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { safeCompare } from "@/server/crypto";
import { logger, newCorrelationId } from "@/lib/logger";
import { enqueueWebhookProcessing } from "@/server/queue/enqueue";
import { extractEventId, extractTopic } from "@/domain/webhooks/process-event";

/**
 * Endpoint de webhook da Omie.
 *
 * Restrições reais que moldam este handler:
 *
 * - A Omie espera resposta em **até 7 segundos** e repete 3 vezes antes de mandar
 *   para a DLQ dela. Então aqui só fazemos o mínimo: validar, persistir o bruto,
 *   enfileirar, responder. Todo o processamento é assíncrono.
 * - A Omie **não publica assinatura HMAC** (docs/known-limitations.md §1, item 2).
 *   A autenticação é um token não-adivinhável na URL, comparado em tempo
 *   constante. Como isso é mais fraco que uma assinatura, o payload é tratado
 *   apenas como gatilho: o worker consulta a API para saber o estado real.
 * - Entrega duplicada é esperada. A deduplicação é por hash do payload, com
 *   constraint única no banco.
 *
 * A resposta é sempre 200 quando o evento foi aceito — inclusive para
 * duplicados. Devolver erro faria a Omie repetir um evento que já temos.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string; token: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const { organizationId, token } = await params;

  const rawBody = await request.text();

  const credential = await prisma.omieCredential.findUnique({
    where: { organizationId },
    select: { webhookSecretToken: true, active: true },
  });

  // Resposta idêntica para organização inexistente e token errado: distinguir
  // permitiria descobrir quais organizações existem.
  if (!credential || !safeCompare(credential.webhookSecretToken, token)) {
    logger.warn(
      { organizationId, correlationId, ip: clientIp(request) },
      "Webhook recusado: token inválido",
    );
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!credential.active) {
    // Integração pausada: aceitamos e descartamos, para a Omie não ficar
    // repetindo indefinidamente enquanto o administrador resolve.
    logger.info({ organizationId, correlationId }, "Webhook ignorado: integração pausada");
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    logger.warn({ organizationId, correlationId }, "Webhook com corpo não-JSON");
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const dedupeKey = createHash("sha256").update(rawBody).digest("hex");

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        organizationId,
        topic: extractTopic(payload),
        omieEventId: extractEventId(payload),
        dedupeKey,
        rawPayload: payload as object,
        sourceIp: clientIp(request),
        status: "RECEIVED",
      },
      select: { id: true },
    });

    await enqueueWebhookProcessing({
      organizationId,
      webhookEventId: event.id,
      correlationId,
    });

    return NextResponse.json({ status: "accepted" }, { status: 200 });
  } catch (error) {
    // P2002 = payload idêntico já recebido. É entrega duplicada, não erro.
    if (isUniqueViolation(error)) {
      await prisma.webhookEvent
        .updateMany({
          where: { organizationId, dedupeKey, status: "RECEIVED" },
          data: { status: "DUPLICATE" },
        })
        .catch(() => undefined);

      logger.info(
        { organizationId, correlationId },
        "Webhook duplicado identificado e descartado",
      );
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    logger.error(
      { organizationId, correlationId, err: String(error) },
      "Falha ao registrar webhook",
    );
    // 500 faz a Omie repetir — que é o que queremos quando o erro é nosso.
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

function clientIp(request: NextRequest): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
