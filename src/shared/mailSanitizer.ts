/**
 * Pure server/test-safe HTML sanitizer that neutralizes scripts, iframes, event handlers,
 * unsafe URL schemes, and layout-breaking CSS rules in email HTML payloads.
 * Client UI additionally runs DOMPurify on top of this output for defense-in-depth.
 */
export function sanitizeEmailHtmlBasic(rawHtml: string): string {
  if (!rawHtml) return '';

  let clean = rawHtml
    // Strip dangerous container elements and their contents
    .replace(/<(script|style|iframe|object|embed|form|meta|link|base)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|meta|link|base)[^>]*\/?>/gi, '')
    // Strip inline event handlers like onclick="..." or onload='...'
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Block javascript:, vbscript:, and data:text/html URLs in href/src
    .replace(/(href|src)\s*=\s*(?:"\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gi, '$1="#"')
    // Neutralize fixed/absolute layout-breaking inline styles
    .replace(/position\s*:\s*(?:fixed|sticky|absolute)/gi, 'position: relative')
    .replace(/z-index\s*:\s*[^;"]+/gi, 'z-index: auto');

  return clean.trim();
}
