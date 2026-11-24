/**
 * Shared display helpers — the small decisions that keep a screen honest.
 */

/**
 * Anything with a display name and an email: a `Member` (name under `profile`),
 * a `Profile`, or a session user. Kept structural so this helper never drags
 * the data layer into a component that only wants a label.
 */
export type PersonLike = {
  /** Member-shaped objects keep the person under `profile`. */
  profile?: { fullName: string | null; email: string } | null;
  fullName?: string | null;
  email?: string | null;
};

const nameOf = (p: PersonLike) => {
  const fullName = (p.profile ? p.profile.fullName : p.fullName) ?? "";
  const email = (p.profile ? p.profile.email : p.email) ?? "";
  return fullName.trim() || email;
};

const emailOf = (p: PersonLike) => (p.profile ? p.profile.email : p.email) ?? "";

export type DisplayName = {
  /** What to show. Just the name unless it is shared. */
  name: string;
  /**
   * Set only when somebody else in the same list has the same display name.
   * The email's local part ("adaniuniversity1218"), which is short enough for a
   * 132px column and precise enough to tell three namesakes apart.
   */
  hint?: string;
};

/**
 * Names that are safe to read on their own.
 *
 * The live studio really has three members called "Roshan Patel", so the team
 * grid showed what looked like the same row painted twice — and an admin could
 * not tell whose hours they were looking at. When a name repeats, every row
 * carries a compact hint (the email before the @) and the full email rides in
 * the `title`. When it does not repeat, nothing changes at all.
 *
 * Keyed by `userId` so callers can look it up by whoever owns the row.
 */
export function distinctNames(people: (PersonLike & { userId: string })[]): Map<string, DisplayName> {
  const seen = new Map<string, number>();
  for (const person of people) {
    const key = nameOf(person).toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const out = new Map<string, DisplayName>();
  for (const person of people) {
    const name = nameOf(person);
    const shared = (seen.get(name.toLowerCase()) ?? 0) > 1;
    const email = emailOf(person) || name;
    const localPart = email.split("@")[0] || email;
    out.set(person.userId, shared ? { name, hint: localPart } : { name });
  }
  return out;
}

/**
 * The short form used where there is only room for one name: "Roshan P.".
 * Falls back to the email's local part when there is no name at all.
 */
export function firstName(name: string | null, email: string): string {
  const clean = (name ?? "").trim();
  if (!clean) return email.split("@")[0] ?? email;
  const [first, ...rest] = clean.split(/\s+/);
  const initial = rest.find((part) => /^[A-Za-z]/.test(part))?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
