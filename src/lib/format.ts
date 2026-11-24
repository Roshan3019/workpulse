/**
 * Shared display helpers — the small decisions that keep a screen honest.
 */

/**
 * The name to print in the app.
 *
 * Deliberately does **not** fall back to the email: the client asked for no
 * member emails across the dashboard ("do not mention any email id of members"),
 * and an address in a name slot is exactly that. A profile with no name yet reads
 * "Unnamed"; the People roster, where identities are managed, is the one screen
 * that still shows the address.
 */
export function displayName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim() || "Unnamed";
}

/**
 * The short form used where there is only room for one name: "Roshan P.".
 * No email fallback, for the same reason as `displayName`.
 */
export function firstName(fullName: string | null | undefined): string {
  const clean = (fullName ?? "").trim();
  if (!clean) return "Unnamed";
  const [first, ...rest] = clean.split(/\s+/);
  const initial = rest.find((part) => /^[A-Za-z]/.test(part))?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
