/** How a provider satisfies search. */
export type SearchCapability =
  /** Provider has no native search; the core MiniSearch fallback is used. */
  | 'core-fallback'
  /** Provider implements search natively (e.g. a database full-text index). */
  | 'native';

/** Static description of what a {@link Provider} supports. */
export interface Capabilities {
  /** Search strategy this provider uses. */
  readonly search: SearchCapability;
  /** True if the store expires documents itself; false means the server must sweep. */
  readonly nativeTtl: boolean;
  /** True if version appends are committed atomically (content-before-pointer). */
  readonly atomicVersioning: boolean;
  /**
   * True if this provider talks to anything off-box (a database, an object
   * store, a remote API). Providers MUST declare this honestly: offline mode
   * refuses to start when a provider reports `true`, and the network fuse would
   * sever its connections anyway. Only a provider that is entirely local —
   * in-process memory, or files on this machine — may report `false`.
   *
   * A unix-domain socket to a local daemon still counts as `true`: the fuse
   * permits unix sockets, but the operator deserves to know the store is not
   * self-contained.
   */
  readonly requiresNetwork: boolean;
}
