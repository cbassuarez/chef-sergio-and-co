/** Account navigation is independent of the existing booking API and its private links. */
export const ACCOUNT_ORIGIN = 'https://chef-sergio-accounts.cbassuarez.workers.dev'

/** Enable only after the same-site account domain and credentialed status endpoint are verified. */
export const ACCOUNT_STATUS_ORIGIN: string | null = null
/** Future same-site handoff: set the verified account origin above, then opt in to status reads. */
export const ACCOUNT_SITE_DOMAIN = 'chefsergioandco.com'

export type AccountDestination = 'bookings' | 'admin' | 'signIn' | 'signOut' | 'createAccount' | 'verifyEmail'
const paths: Record<AccountDestination, string> = {
  bookings: '/dashboard/', admin: '/admin/', signIn: '/account/sign-in/', signOut: '/auth/logout', createAccount: '/account/create/', verifyEmail: '/account/verify-email/',
}
export const accountHref = (destination: AccountDestination) => new URL(paths[destination], ACCOUNT_ORIGIN).href

/** Restrict automatic cookie-bearing reads to the explicitly configured, same-site account host. */
export function accountStatusUrl(configured: string | null, pageOrigin: string, accountOrigin = ACCOUNT_ORIGIN): string | null {
  if (!configured) return null
  try {
    const candidate = new URL(configured), page = new URL(pageOrigin), account = new URL(accountOrigin)
    const ownedHost = (hostname: string) => hostname === ACCOUNT_SITE_DOMAIN || hostname.endsWith('.' + ACCOUNT_SITE_DOMAIN)
    if (candidate.origin !== configured || candidate.origin !== account.origin || candidate.protocol !== 'https:' || page.protocol !== 'https:' || !ownedHost(candidate.hostname) || !ownedHost(page.hostname) || candidate.username || candidate.password) return null
    return candidate.origin + '/api/auth/status'
  } catch { return null }
}
