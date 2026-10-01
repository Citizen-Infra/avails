import { CALL_ID_RE } from './callBookings.js';

export function callLoginState(id) {
  return typeof id === 'string' && CALL_ID_RE.test(id) ? `call:${id}` : undefined;
}

// Receives only the application state from the SDK's verified callback, never
// an unverified query string or client-supplied arbitrary return URL.
export function callLoginReturn(state) {
  const id = typeof state === 'string' && state.startsWith('call:') ? state.slice(5) : null;
  return typeof id === 'string' && CALL_ID_RE.test(id) ? `/calls/${id}` : '/';
}
