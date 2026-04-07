const API_BASE = '';

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return res.json();
}

export async function getSession() { return apiFetch('/api/auth/session'); }
export async function createPoll(data) { return apiFetch('/api/polls', { method: 'POST', body: JSON.stringify(data) }); }
export async function getPoll(did, rkey) { return apiFetch(`/api/polls/${did}/${rkey}`); }
export async function submitResponse(did, rkey, data) { return apiFetch(`/api/polls/${did}/${rkey}/responses`, { method: 'POST', body: JSON.stringify(data) }); }
export async function updateResponse(did, rkey, responseRkey, data) { return apiFetch(`/api/polls/${did}/${rkey}/responses/${responseRkey}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function finalizePoll(did, rkey, finalTime, finalDuration, notifyEmails) { return apiFetch(`/api/polls/${did}/${rkey}/finalize`, { method: 'PUT', body: JSON.stringify({ finalTime, finalDuration, notifyEmails }) }); }
export async function updatePoll(did, rkey, data) { return apiFetch(`/api/polls/${did}/${rkey}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function getCommunities() { return apiFetch('/api/communities'); }
export async function getMyPolls() { return apiFetch('/api/polls/my'); }
export async function deletePoll(did, rkey) { return apiFetch(`/api/polls/${did}/${rkey}`, { method: 'DELETE' }); }
export async function deleteResponse(did, rkey, responseRkey) { return apiFetch(`/api/polls/${did}/${rkey}/responses/${responseRkey}`, { method: 'DELETE' }); }
export async function publishToOpenMeet(data) { return apiFetch('/api/openmeet/publish', { method: 'POST', body: JSON.stringify(data) }); }
export async function getOpenMeetAvailability(startTime, endTime) { return apiFetch('/api/openmeet/availability', { method: 'POST', body: JSON.stringify({ startTime, endTime }) }); }
