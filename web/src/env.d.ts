// Build-time constants (vite.config.ts `define`). The static site sets them
// to its build; the default build, which is committed, sets them to null so
// that its output never changes from one build to the next.

/** The commit the site was built from (7 hex digits), or "dev". */
declare const __MHJDOJO_SITE_VERSION__: string | null;
/** A hash of everything the site was built from: it changes with any change that reaches the page. */
declare const __MHJDOJO_SITE_ID__: string | null;
/** When the site was built (ISO 8601). */
declare const __MHJDOJO_SITE_BUILT__: string | null;
/** The release the site was built as (e.g. v2026.0927.0), or null outside the Release site workflow. */
declare const __MHJDOJO_SITE_RELEASE__: string | null;
