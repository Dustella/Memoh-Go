/**
 * Access-token lifetime rules (contracts/u2-auth.md). Memoh has no separate
 * refresh token: `/auth/refresh` re-signs a still-valid access token, so a
 * token that expired can only be replaced by signing in again.
 */
export type Credential = Readonly<{
  accessToken: string;
  /** Expiry on the *device* clock (server expiry corrected for clock skew). */
  expiresAt: number;
  /** Device time the token was issued to us. */
  receivedAt: number;
}>;

/** Refresh once less than this fraction of the lifetime remains. */
export const REFRESH_REMAINING_FRACTION = 0.25;
/** Treat a token as expired slightly early, so a request never races expiry. */
export const EXPIRY_MARGIN_MS = 60_000;

/**
 * Build a credential from a login/refresh response. The server's `Date`
 * header, when present, corrects for a device clock that is off.
 */
export function credentialFromResponse(
  body: { access_token: string; expires_at: string },
  receivedAt: number,
  serverDate?: string | null,
): Credential {
  const serverExpiry = Date.parse(body.expires_at);
  if (!body.access_token || Number.isNaN(serverExpiry)) throw new Error('Malformed token response');
  const serverNow = serverDate ? Date.parse(serverDate) : Number.NaN;
  const skew = Number.isNaN(serverNow) ? 0 : receivedAt - serverNow;
  return { accessToken: body.access_token, expiresAt: serverExpiry + skew, receivedAt };
}

export function isExpired(credential: Credential, now: number): boolean {
  return now >= credential.expiresAt - EXPIRY_MARGIN_MS;
}

export function refreshDue(credential: Credential, now: number): boolean {
  if (isExpired(credential, now)) return false; // too late: only a new sign-in helps
  const lifetime = Math.max(0, credential.expiresAt - credential.receivedAt);
  return credential.expiresAt - now < lifetime * REFRESH_REMAINING_FRACTION;
}

/** OSS deployments have exactly one Team with this fixed id (Memoh 0001_init). */
export const OSS_DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000001';
