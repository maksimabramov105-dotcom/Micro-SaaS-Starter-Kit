/**
 * connect-bridge.js — Content script for resumeai-bot.com/extension/connect
 *
 * Listens for the RESUMEAI_API_KEY postMessage from the connect page and
 * forwards it to the background service worker, which stores it securely.
 *
 * Security: we only accept messages from the trusted origin.
 */

window.addEventListener('message', (event) => {
  // Only accept messages from the ResumeAI origin
  // Both origins accepted: .ru still 301s to .com, and an extension
  // installed before the migration would otherwise silently stop pairing.
  if (event.origin !== 'https://resumeai-bot.com' && event.origin !== 'https://resumeai-bot.ru') return
  if (!event.data || event.data.type !== 'RESUMEAI_API_KEY') return
  if (!event.data.key || typeof event.data.key !== 'string') return

  chrome.runtime.sendMessage(
    { type: 'SAVE_API_KEY', key: event.data.key },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[ResumeAI] Failed to save API key:', chrome.runtime.lastError.message)
        return
      }
      if (response?.ok) {
        console.log('[ResumeAI] Extension API key saved successfully.')
      }
    },
  )
})
