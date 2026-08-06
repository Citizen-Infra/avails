// What a scope IS: parsing, validating, and comparing the group reference on a
// standing-availability record.
//
// Its own module because two callers need it and they must not disagree.
// tools.js normalizes what an MCP caller sent; listMembers.js decides whether a
// record in someone's PDS matches. A scope that normalized one way and matched
// another would book people from a group they never offered themselves to, so
// the two answers come from one place. (listMembers.js's header notes there was
// no shared helper module yet — this is it, for scopes only.)
//
// The shape mirrors the record's own #scope def:
// lexicons/chat/avails/scheduling/availability.json

const LIST_COLLECTION = 'app.bsky.graph.list';

export const SCOPE_TYPES = ['atproto-list', 'ca-community'];

// Validates `at://<did>/app.bsky.graph.list/<rkey>` shape and returns the
// authority DID, which is the list's owner — a record can only live in its
// own creator's repo, so this holds without trusting any API response shape.
// Throws otherwise.
export function parseListUri(listUri) {
  if (typeof listUri !== 'string' || !listUri.startsWith('at://')) {
    throw new Error(`Invalid list URI: ${listUri}`);
  }
  const segments = listUri.slice('at://'.length).split('/');
  const [did, collection, rkey] = segments;
  if (!did || collection !== LIST_COLLECTION || !rkey) {
    throw new Error(`Not an ${LIST_COLLECTION} URI: ${listUri}`);
  }
  return did;
}

// Accepts either a bare list-URI string or an explicit { type, value } object.
// Does not validate that `value` is well-formed — assertResolvableScope does
// that per type, because the two are needed at different moments: a caller's
// input is normalized before authorization, and validated before resolution.
export function normalizeScope(scope) {
  // A bare string is unambiguous shorthand — there is only one kind of URI a
  // caller can pass — so it still defaults.
  if (typeof scope === 'string') {
    return { type: 'atproto-list', value: scope };
  }
  if (scope && typeof scope === 'object' && typeof scope.value === 'string') {
    // An object that names no type is a caller bug, not shorthand: defaulting
    // it silently sent a mistyped ca-community scope down the list path, where
    // it failed later with an unrelated error about the URI shape.
    if (scope.type === undefined) {
      throw new Error(`scope.type is required when scope is an object: one of ${SCOPE_TYPES.join(', ')}`);
    }
    if (!SCOPE_TYPES.includes(scope.type)) {
      throw new Error(`Unknown scope.type "${scope.type}": expected one of ${SCOPE_TYPES.join(', ')}`);
    }
    return { type: scope.type, value: scope.value };
  }
  throw new Error(
    'scope is required: either an at://<did>/app.bsky.graph.list/<rkey> URI string, or { type, value }'
  );
}

// A malformed scope must throw rather than resolve to an empty set, which would
// masquerade as thin coverage — "nobody published availability" and "you asked
// the wrong question" must never produce the same answer.
export function assertResolvableScope(scope) {
  if (scope.type === 'atproto-list') {
    parseListUri(scope.value);
    return;
  }
  if (scope.type === 'ca-community') {
    if (!scope.value.trim()) {
      throw new Error('ca-community scope requires a non-empty community id');
    }
    return;
  }
  throw new Error(`Unsupported scope type "${scope.type}": expected one of ${SCOPE_TYPES.join(', ')}`);
}

// Both halves must agree. Comparing `value` alone — which is what the matcher
// did while atproto-list was the only supported type — would let a
// ca-community record whose id happened to equal a list URI satisfy a list
// scope. Vanishingly unlikely, but the check is free and what it prevents is
// booking someone into a group they never offered themselves to.
//
// A record carrying no `scope.type` matches nothing: the lexicon has required
// it since the first version, so an untyped scope is an invalid record rather
// than an older one.
export function scopeMatches(recordScope, scope) {
  if (!recordScope || typeof recordScope !== 'object') return false;
  return recordScope.type === scope.type && recordScope.value === scope.value;
}
