# VeriRef — Decentralized Employment Attestation & Verification Network

## Problem

Reference and employment-history checks today are broken:

- **Unverifiable**: reference letters and LinkedIn "recommendations" are trivially forged or exaggerated. There is no cryptographic proof an attestation actually came from the claimed employer.
- **Non-portable**: every new job application repeats the same manual reference-check process. The employee doesn't *own* a reusable, verified record of their work history.
- **Privacy-hostile**: to prove *anything* (e.g. "I worked here 2 years"), the employee/verifier ends up needing the full record, including sensitive fields (exact salary, performance rating, manager comments) they never intended to share.
- **No accountability**: an employer can lie (inflate a reference for a friend, or unfairly retaliate with a bad one) with zero consequence — there's no economic or reputational cost.

Existing "blockchain for credentials" projects (diploma/certificate verification) don't solve this — they anchor a one-time static document (a degree), not an ongoing, disputable, field-sensitive employment record.

## Solution: VeriRef

A network where:

1. **Employers stake collateral** to register as verified "Attesters" — skin in the game, not free-to-lie.
2. **Attestations are signed off-chain, anchored on-chain** as a Merkle root (not the raw data) — full record stays private, only a commitment is public.
3. **Employees selectively disclose** individual fields (role, dates, "rating above X") to a verifier via Merkle proofs, without revealing the rest of the record or requiring the employer to be re-contacted.
4. **Disputes are resolved by a staked jury** using commit-reveal voting. A fraudulent attester gets slashed and loses reputation; a validated attestation stands.
5. **Reputation accrues on-chain**, giving verifiers a trust signal independent of any single attestation.

## Why this is a good course project

Touches the core pillars of a blockchain/distributed-systems course in one coherent system, not as disconnected demos:

| Concept | Where it shows up |
|---|---|
| Consensus / distributed agreement | Jury commit-reveal voting to resolve disputes |
| Smart contract economics | Staking, slashing, bonded disputes |
| Applied cryptography | Merkle trees for selective disclosure, ECDSA signatures |
| Decentralized storage | IPFS for encrypted off-chain credential blobs |
| State machines on-chain | Attestation lifecycle: issued → disclosed → (optionally) disputed → resolved |

## Why it's unlikely to collide with classmates

Research into common student blockchain projects (see below) shows the well-worn ideas are: e-voting, diploma/certificate verification, generic supply-chain traceability, and donation tracking. VeriRef is adjacent to none of these — it's about *ongoing employment history with economic accountability and privacy-preserving disclosure*, which none of the common templates cover.

Sources consulted: capstone-idea roundups (writepaperfor.me, itsourcecode.com, guvi.in) confirming the cliché list; W3C Verifiable Credentials / decentralized-identity trend pieces (dock.io, securityboulevard.com) confirming selective disclosure is a live, real-world-relevant pattern (notably driven by EU eIDAS 2.0 in 2026), not a toy concept.

## Scope for MVP (solo, fast build)

**In scope:**
- Attester registration + staking
- Attestation issuance with Merkle-root anchoring
- Selective disclosure proof generation + on-chain verification
- Dispute raising + commit-reveal jury voting + slashing
- Minimal frontend for all three roles (Attester / Employee / Verifier)

**Explicitly out of scope (future work, not needed for a strong demo):**
- zk-SNARK-based disclosure (Merkle proofs give the same practical privacy guarantee here without the circuit-design overhead)
- Real IPFS pinning infrastructure at scale (a single Pinata/web3.storage integration is enough)
- Mobile wallet support, ENS names, multi-chain deployment
