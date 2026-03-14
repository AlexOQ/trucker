/**
 * Shared clipboard utility with visual feedback.
 * Provides a consistent copy-to-clipboard experience across all pages.
 */

/**
 * Copy text to clipboard and show visual feedback on the triggering button.
 * On success: button shows "Copied!" with green styling for 2 seconds.
 * On failure: button shows "Failed" with red styling for 2 seconds.
 */
export async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
  const originalText = button.textContent;
  const originalClass = button.className;

  // Find or create aria-live region for screen reader announcement
  let liveRegion = document.getElementById('copy-status');
  if (!liveRegion) {
    liveRegion = document.createElement('span');
    liveRegion.id = 'copy-status';
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
  }

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '\u2713 Copied!';
    button.classList.add('copy-success');
    liveRegion.textContent = 'Copied to clipboard';
  } catch {
    button.textContent = 'Failed';
    button.classList.add('copy-fail');
    liveRegion.textContent = 'Copy failed';
  }

  setTimeout(() => {
    button.textContent = originalText;
    button.className = originalClass;
    liveRegion!.textContent = '';
  }, 2000);
}
