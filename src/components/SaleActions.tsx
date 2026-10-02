"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRecipeFromSaleAction, voidSaleAction } from "@/app/actions";

export function VoidSaleButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!window.confirm("Void this sale and return the ingredients to inventory?")) return;
    setPending(true);
    const result = await voidSaleAction(saleId);
    setPending(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="stack">
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-danger" type="button" onClick={onClick} disabled={pending}>
        {pending ? "Voiding…" : "Void sale"}
      </button>
    </div>
  );
}

export function SaveRecipeButton({
  saleId,
  lineId,
  hasRecipe,
}: {
  saleId: string;
  lineId: string;
  hasRecipe: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await saveRecipeFromSaleAction(saleId, lineId);
    setPending(false);
    if (!result.ok) setError(result.error);
    else setMessage(hasRecipe ? "Default recipe updated from this sale." : "Saved as the default recipe.");
  }

  return (
    <div className="stack">
      <button className="btn" type="button" onClick={onClick} disabled={pending}>
        {pending ? "Saving…" : hasRecipe ? "Update default recipe" : "Save as default recipe"}
      </button>
      {message ? <p className="preview">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
