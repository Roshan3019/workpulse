"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { requestToJoinAction } from "@/lib/actions/joining";

/**
 * The requester's one action. A short note is optional — admins see it in the
 * inbox, which is how "who is this person?" gets answered before approving.
 */
export function RequestToJoin({ token }: { token: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-white px-3.5 py-3">
        <p className="text-[13px] font-medium text-ink">Request sent</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          An admin will approve it. You can close this page. You&apos;ll be let in from their
          dashboard.
        </p>
      </div>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await requestToJoinAction(token, note);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSent(true);
      router.refresh();
    });
  }

  return (
    <form
      action={submit}
      className="space-y-3"
    >
      <div className="field">
        <label htmlFor="join-note">Anything to add? (optional)</label>
        <textarea
          id="join-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. I do motion design, Priya said to ask."
        />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <button type="submit" disabled={pending} className="btn-primary h-11 w-full">
        {pending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
