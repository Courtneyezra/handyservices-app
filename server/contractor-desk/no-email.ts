/**
 * A contractor added without an email still needs one, because `users.email` is required and
 * unique. They get an address on a reserved `.invalid` domain, which nothing can deliver to, and the
 * roster shows it as no email.
 */
export const NO_EMAIL_DOMAIN = 'no-email.contractors.invalid';

export function placeholderEmail(profileId: string): string {
  return `contractor-${profileId}@${NO_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${NO_EMAIL_DOMAIN}`);
}
