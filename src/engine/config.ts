/** The engine only needs a credential pair; the app passes empty values unless a dev login is configured. */
export interface KuLmsConfig {
  readonly userId: string;
  readonly password: string;
}
