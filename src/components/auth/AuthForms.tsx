"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/Modal";
import { signInWithPassword, signUpWithPassword, getOAuthUrl, type ActionState } from "@/lib/actions/auth";

const initial: ActionState = {};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

export function GoogleButton({ label = "Continue with Google", next = "/app" }: { label?: string; next?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await getOAuthUrl(next);
            if (res.error) setError(res.error);
            else if (res.url) window.location.href = res.url;
          })
        }
        className="flex w-full items-center justify-center gap-3 rounded-full border border-line-2 bg-white px-4 py-3.5 text-[14.5px] font-semibold transition hover:border-[#c7ccdf] hover:shadow-[0_1px_3px_rgba(16,24,40,.08)] disabled:opacity-60"
      >
        <GoogleIcon />
        {pending ? "Redirecting…" : label}
      </button>
      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </div>
  );
}

export function LoginForm({ next = "/app" }: { next?: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3.5">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@studio.com" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </div>
        {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
        <button type="submit" disabled={pending} className="btn-primary w-full py-3">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-[12px] font-semibold text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton />

      <p className="text-center text-[13px] text-muted">
        New here?{" "}
        <Link href="/signup" className="font-bold text-brand">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpWithPassword, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3.5">
        <div className="field">
          <label htmlFor="fullName">Your name</label>
          <input id="fullName" name="fullName" required autoComplete="name" placeholder="Roshna Patel" />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@studio.com" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>
        {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state?.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
        <button type="submit" disabled={pending} className="btn-primary w-full py-3">
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-[12px] font-semibold text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton label="Sign up with Google" next="/onboarding" />

      <p className="text-center text-[13px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-brand">
          Sign in
        </Link>
      </p>
    </div>
  );
}
