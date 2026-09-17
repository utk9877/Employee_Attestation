# Feasibility Analysis

## Risk by component

| Component | Risk | Why |
|---|---|---|
| AttesterRegistry (stake/register/slash hook) | **Low** | Standard staking pattern, OpenZeppelin primitives cover the sharp edges (reentrancy, access control). |
| AttestationRegistry (anchor Merkle root + signature) | **Low** | Storing a bytes32 root + verifying `MerkleProof.verify()` is a well-documented OZ pattern. |
| Merkle-based selective disclosure (off-chain) | **Low** | Deterministic, no cryptographic research needed — `merkletreejs` handles tree construction; verification is a library call. |
| IPFS storage of encrypted blob | **Low** | A few lines against web3.storage/Pinata SDK. Can be stubbed with localStorage first and swapped in later without touching contract logic. |
| DisputeResolution (commit-reveal jury + slashing) | **Medium** | Multi-actor, multi-transaction, time-windowed (commit phase → reveal phase → resolve). Most likely place to lose time to edge cases (non-revealing jurors, tie votes, re-entrancy on slashing payout). Build last, after the core flow is demoable. |
| Frontend wiring (3 roles, wallet flows) | **Medium** | Not technically hard, but is the most time-consuming in raw hours — budget accordingly. |

## Overall verdict

**Feasible for a solo, fast-timeline build.** Every "Low" risk component is a known, well-documented pattern with library support (OpenZeppelin + merkletreejs) — you're composing, not inventing. The only genuinely novel *engineering* work is wiring these known primitives into the specific attest → disclose → dispute lifecycle, which is a design/integration task, not a research one.

## Build-order recommendation (each stage independently demoable)

1. `AttesterRegistry` (register, stake, withdraw) + tests
2. `AttestationRegistry` (issue, anchor root+signature) + tests
3. Off-chain Merkle tree + selective-disclosure proof gen/verify — as a **Node script first, no UI**, to validate the crypto in isolation
4. Minimal frontend: connect wallet → register attester → issue attestation → generate & verify a selective disclosure
5. `DisputeResolution` (commit-reveal jury, slashing) + tests
6. Frontend for the dispute flow
7. Polish: real IPFS integration, reputation display, demo script/README

Stopping after step 4 already yields a complete, demoable core product (attest + selectively disclose + verify) even if the dispute flow (step 5-6, the highest-risk part) needs to be cut for time — so the schedule has a natural fallback point built in.

## What would make this infeasible (and mitigations)

- **Running out of time on the dispute contract** → mitigated by building it last; core demo doesn't depend on it.
- **IPFS integration flakiness during a live demo** → mitigated by keeping a localStorage fallback path so the demo never depends on network availability.
- **Merkle proof / signature verification bugs** → mitigated by testing the crypto as a standalone Node script (step 3) before any UI or contract integration touches it.
