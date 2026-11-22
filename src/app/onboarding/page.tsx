import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { createOrganizationAction } from "@/lib/actions/org";
import { getAuthContext } from "@/lib/session";

export const metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.membership) redirect("/app");

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
      </div>

      <main className="mx-auto max-w-lg px-5 py-10">
        <div className="card p-6 sm:p-8">
          <p className="label">Step 1 of 1</p>
          <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.02em]">
            Name your workspace
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            This is your team&apos;s home in WorkPulse — you&apos;ll be the owner. You can rename it later.
          </p>

          <form
            action={async (formData: FormData) => {
              "use server";
              await createOrganizationAction(formData);
            }}
            className="mt-6 space-y-4"
          >
            <div className="field">
              <label htmlFor="name">Team or studio name</label>
              <input
                id="name"
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={
                  ctx.user.fullName ? `${ctx.user.fullName.split(" ")[0]}'s Studio` : ""
                }
                placeholder="e.g. Cinegem Studio"
              />
            </div>
            <Alert tone="info">
              Signed in as <b>{ctx.user.email}</b>. Next you&apos;ll get a shareable invite link for your freelancers.
            </Alert>
            <button type="submit" className="btn-primary w-full py-3">
              Create workspace
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
