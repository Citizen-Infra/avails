// Per-response control-plane budgets, not limits on PDS records or concurrency.
// The byte ceiling matches @atproto-labs/fetch-node's safe-fetch default. The
// structural ceilings leave room for large capability lists and DID documents,
// but reject pathological documents before JSON.parse/Zod can amplify them.
export const OAUTH_INPUT_LIMITS = Object.freeze({
  bytes: 512 * 1024,
  depth: 32,
  collection: 1024,
  tokens: 8192, // Includes object member names, not just JSON values.
  timeoutMs: 10_000,
});

export class OAuthInputBudgetError extends Error {
  constructor(dimension) {
    super(`OAuth provider response exceeds the ${dimension} budget`);
    this.name = 'OAuthInputBudgetError';
    this.code = 'OAUTH_INPUT_BUDGET';
    this.status = 502;
  }
}

// This is a lexical budget preflight, NOT a replacement JSON parser. Quoted
// delimiters/escapes are skipped; JSON.parse in the SDK still checks grammar.
// Scan before parsing so deeply nested JSON and large collections never become
// object graphs or per-element Zod issues. Count duplicate object keys too.
export function checkOAuthJsonBudget(text, limits = OAUTH_INPUT_LIMITS) {
  const stack = [];
  let quoted = false, escaped = false, primitive = false, tokens = 0;
  for (const ch of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (primitive) {
      if (!/[\s,\]}:]/.test(ch)) continue;
      primitive = false;
    }
    if (/\s/.test(ch) || ch === ':') continue;
    if (ch === '}' || ch === ']') { stack.pop(); continue; }
    if (ch === ',') {
      if (stack.length) stack.at(-1).next = true;
      continue;
    }
    if (++tokens > limits.tokens) throw new OAuthInputBudgetError('JSON token');
    const parent = stack.at(-1);
    if (parent?.next) {
      if (++parent.count > limits.collection) throw new OAuthInputBudgetError('collection');
      parent.next = false;
    }
    if (ch === '{' || ch === '[') {
      stack.push({ count: 0, next: true });
      if (stack.length > limits.depth) throw new OAuthInputBudgetError('JSON depth');
    } else if (ch === '"') quoted = true;
    else primitive = true;
  }
}

// Native Response reconstruction otherwise loses these read-only fields. The
// SDK peeks at cloned error responses during DPoP nonce handling, so clones must
// keep both the original metadata and the unchanged, already-bounded bytes.
function preserveMetadata(response, original) {
  Object.defineProperties(response, {
    url: { value: original.url },
    redirected: { value: original.redirected },
    type: { value: original.type },
    clone: { value() { return preserveMetadata(Response.prototype.clone.call(this), original); } },
  });
  return response;
}

export function createOAuthBudgetFetch(fetchImpl = globalThis.fetch, overrides = {}) {
  const limits = Object.freeze({ ...OAUTH_INPUT_LIMITS, ...overrides });
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('OAuth input budgets must be positive safe integers');
  }
  return async function (input, init) {
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new OAuthInputBudgetError('response time')), limits.timeoutMs);
    let reader;
    const cancel = () => { reader?.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      // Preserve method, body, headers, redirect mode and credentials. Never
      // clone/replay a request; DPoP and refresh retries remain the SDK's job.
      const response = await fetchImpl.call(this, input, { ...init, signal });
      reader = response.body?.getReader();
      signal.throwIfAborted();
      if (!reader) return response;
      const length = response.headers.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > limits.bytes) {
        throw new OAuthInputBudgetError('response byte');
      }
      // A fixed buffer also bounds overhead for many tiny/empty stream chunks;
      // an array of per-chunk buffers can be much larger than its byte count.
      const buffer = Buffer.allocUnsafe(limits.bytes);
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        if (chunk.value.byteLength > limits.bytes - bytes) throw new OAuthInputBudgetError('response byte');
        buffer.set(chunk.value, bytes);
        bytes += chunk.value.byteLength;
      }
      const body = buffer.subarray(0, bytes);
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (mime === 'application/json' || mime?.endsWith('+json')) {
        checkOAuthJsonBudget(body.toString('utf8'), limits);
      }
      return preserveMetadata(new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }), response);
    } catch (error) {
      controller.abort(error); // Cancels pending body reads without awaiting an untrusted stream.
      cancel(); // The caller may have aborted before the response/reader arrived.
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reader?.releaseLock();
    }
  };
}
