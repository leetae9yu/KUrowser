/** Safe public errors shared by the live provider and CLI. */

/** A safe-to-print live command failure. */
export class LiveCommandError extends Error {
  override name = "LiveCommandError";
}

/** The player requires authentication again. */
export class LoginExpired extends LiveCommandError {
  override name = "LoginExpired";
}

/** Invalid configuration or input (Python ValueError). */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** A fixture item lookup failed (Python KeyError). */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
