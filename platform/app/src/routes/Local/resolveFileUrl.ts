/**
 * Validation for the `?url=` parameter the `/home` route loads imaging from.
 *
 * This deliberately mirrors the checks in
 * `extensions/default/src/utils/secureConfigFetch.js` — same protocol, userinfo
 * and fragment rules, same "bare origins only" allowlist parsing — but it is a
 * separate implementation for two reasons:
 *
 *  1. `secureConfigFetch` lives inside `@ohif/extension-default` and is not part
 *     of that package's public API. `platform/app` does not depend on any
 *     extension directly, and reaching into one's internals would invert the
 *     app/extension layering.
 *  2. Its origin allowlist is only enforced `if (isAuthenticated && !isSameOrigin)`
 *     — it exists to stop an auth token leaking to a third party. This
 *     deployment has no authentication (`PrivateRoute` is inert unless OIDC is
 *     configured), so that check would never fire. Here the allowlist is
 *     enforced unconditionally, because the URL *is* the credential.
 *
 * If you change a rule here, change it there too.
 *
 * Pure functions over strings — no fetch, no DOM — so they are unit-testable,
 * matching the approach in `detectFileFormat.ts`.
 */

/**
 * Parses configured origins, discarding anything that is not a bare origin.
 * A path, query, fragment or userinfo in an allowlist entry is a
 * misconfiguration that would otherwise silently widen or narrow the rule.
 */
export function normalizeAllowedOrigins(allowedOrigins: unknown): string[] {
  if (!Array.isArray(allowedOrigins)) {
    return [];
  }

  return allowedOrigins
    .filter((origin): origin is string => typeof origin === 'string')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        console.error(`[resolveFileUrl] Ignoring allowed origin "${origin}": not a valid URL.`);
        return null;
      }

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.error(
          `[resolveFileUrl] Ignoring allowed origin "${origin}": must use http:// or https://.`
        );
        return null;
      }

      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        console.error(
          `[resolveFileUrl] Ignoring allowed origin "${origin}": entries must be a bare origin ` +
            '(scheme + host + optional port) with no userinfo, path, query or fragment.'
        );
        return null;
      }

      return parsed.origin;
    })
    .filter((origin): origin is string => Boolean(origin));
}

/**
 * A form of the URL that is safe to log.
 *
 * Signed URLs carry their signature, expiry and often the object key in the
 * query string, so logging one verbatim writes a working credential for a
 * patient's imaging into the browser console. Origin and path are enough to
 * identify what failed.
 */
export function redactUrl(url: URL | string | null | undefined): string {
  if (!url) {
    return '(no url)';
  }

  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    const redacted = `${parsed.origin}${parsed.pathname}`;
    return parsed.search ? `${redacted}?<redacted>` : redacted;
  } catch {
    // Unparseable input is the caller's raw string; naming it would echo back
    // whatever was in the query parameter.
    return '(unparseable url)';
  }
}

type ResolveOptions = {
  /** Origins the viewer may fetch imaging from, in addition to its own. */
  allowedOrigins?: unknown;
  /** The page's own origin; always permitted. */
  pageOrigin: string;
  /**
   * `window.config.name` — the config file actually in effect. Named in the
   * error because which file that is, is the least obvious part of fixing this:
   * the dev server serves `config/dev.js` while a production build serves
   * `config/default.js` (see the APP_CONFIG default in
   * `platform/app/.webpack/webpack.pwa.js`), so editing the wrong one looks
   * exactly like the setting being ignored.
   */
  configName?: string;
};

/**
 * Validates the raw `?url=` value and returns the URL to fetch.
 *
 * Throws — rather than returning null — so the caller's existing catch reports
 * the reason and shows the generic notice. The messages name the exact config
 * key to set, because the most likely failure in production is an allowlist
 * that was never configured.
 *
 * @throws if the value is missing, unparseable, not http(s), carries userinfo
 *   or a fragment, or points at an origin that is neither the page's own nor
 *   explicitly allowed.
 */
export function resolveLocalFileUrl(
  rawUrl: string | null | undefined,
  { allowedOrigins, pageOrigin, configName }: ResolveOptions
): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing required "url" query parameter.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl, pageOrigin);
  } catch {
    throw new Error('The "url" query parameter is not a valid URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
    throw new Error(
      `Blocked "url" with protocol "${parsed.protocol}" — only http: and https: are allowed.`
    );
  }

  // Credentials embedded in the URL would be sent on the request and written
  // wherever the URL is recorded.
  if (parsed.username || parsed.password) {
    throw new Error('Blocked "url" containing embedded credentials.');
  }

  if (parsed.hash) {
    throw new Error('Blocked "url" containing a fragment.');
  }

  if (parsed.origin === pageOrigin) {
    return parsed;
  }

  const normalized = normalizeAllowedOrigins(allowedOrigins);
  if (!normalized.includes(parsed.origin)) {
    const configFile = configName || 'the active app config';
    const currently = normalized.length
      ? `currently allows: ${normalized.join(', ')}`
      : 'currently allows no cross-origin hosts';

    throw new Error(
      `Blocked "url" origin "${parsed.origin}". Add it to \`allowedLocalFileOrigins\` in ` +
        `${configFile} — e.g. allowedLocalFileOrigins: ['${parsed.origin}'] — then restart the ` +
        `dev server or rebuild. (${configFile} ${currently}.)`
    );
  }

  return parsed;
}
