/**
 * Copies text to the clipboard. Prefers the async Clipboard API (needs a
 * secure context — fine in prod/localhost, but some in-app mobile browser
 * webviews still don't expose it), falling back to a hidden-textarea +
 * execCommand('copy') so "copy report, paste into WhatsApp" works from a
 * phone regardless.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy fallback below.
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // Keep it in the document (required by execCommand) but off-screen.
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
