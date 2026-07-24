"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { decideApprovalAction } from "./actions";

export function ApprovalButtons({
  approvalId,
}: {
  approvalId: string;
}): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function decide(decision: "APPROVED" | "REJECTED"): void {
    const label = decision === "APPROVED" ? "Aprovar" : "Recusar";
    if (!window.confirm(`${label} este desconto?`)) return;

    setMessage(null);
    startTransition(async () => {
      const result = await decideApprovalAction(approvalId, decision);
      setMessage(
        result.ok
          ? { ok: true, text: result.data.message }
          : { ok: false, text: result.error.message },
      );
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" pending={pending} onClick={() => decide("APPROVED")}>
          Aprovar
        </Button>
        <Button
          size="sm"
          variant="destructive"
          pending={pending}
          onClick={() => decide("REJECTED")}
        >
          Recusar
        </Button>
      </div>
      {message && (
        <p
          role="status"
          className={
            message.ok
              ? "text-sm text-[color:var(--color-success)]"
              : "text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
