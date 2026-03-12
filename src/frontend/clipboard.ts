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

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '\u2713 Copied!';
    button.classList.add('copy-success');
  } catch {
    button.textContent = 'Failed';
    button.classList.add('copy-fail');
  }

  setTimeout(() => {
    button.textContent = originalText;
    button.className = originalClass;
  }, 2000);
}
