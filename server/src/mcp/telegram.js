/**
 * @param {string} chatId - Telegram chat ID (e.g., "-1002708526104")
 * @param {string} text - message text
 * @param {object} [options] - optional parameters
 * @param {number|string} [options.messageThreadId] - forum topic thread ID
 * @returns {object} Telegram API response
 * @throws {Error} if bot token not configured or API fails
 */
export async function sendTelegramMessage(chatId, text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  };
  if (options.messageThreadId) {
    body.message_thread_id = Number(options.messageThreadId);
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description}`);
  }

  return result;
}
