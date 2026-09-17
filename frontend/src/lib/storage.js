// localStorage-backed stand-ins for what would, in a production build, be:
//  - encrypted credential blobs on IPFS (see PLAN.md Stage 7)
//  - the juror's own private note of which vote they committed to
// Keeping these local-only is explicitly the Stage 4 scope decision from
// FEASIBILITY.md: it lets the crypto/contract flow be demoed without a live
// IPFS dependency, and can be swapped later without touching contract logic.

const CRED_PREFIX = "veriref:credentials:";
const VOTE_PREFIX = "veriref:vote:";

export function saveCredential(ownerAddress, record) {
  const key = CRED_PREFIX + ownerAddress.toLowerCase();
  const existing = getCredentials(ownerAddress);
  const withoutDup = existing.filter((c) => c.attestationId !== record.attestationId);
  localStorage.setItem(key, JSON.stringify([...withoutDup, record]));
}

export function getCredentials(ownerAddress) {
  const key = CRED_PREFIX + ownerAddress.toLowerCase();
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : [];
}

export function saveVoteSecret(disputeId, jurorAddress, secret) {
  const key = `${VOTE_PREFIX}${disputeId}:${jurorAddress.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(secret));
}

export function getVoteSecret(disputeId, jurorAddress) {
  const key = `${VOTE_PREFIX}${disputeId}:${jurorAddress.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
