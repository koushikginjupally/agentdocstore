/** The resolved caller identity. */
export interface Identity {
  /** The authenticated user, or the configured single-user default. */
  readonly user: string;
}

/**
 * Resolves the caller identity from request headers. Implementations are
 * selected by server auth mode (single-user / trusted-header / token).
 */
export interface IdentityProvider {
  identify(headers: Readonly<Record<string, string | undefined>>): Identity | Promise<Identity>;
}
