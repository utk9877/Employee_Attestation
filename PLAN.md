# Build Plan

Solo, fast-timeline build. Order matches FEASIBILITY.md's build-order recommendation — each stage is independently demoable, so the project is never "broken" between stages.

## Stage 0 — Scaffold ✅
- [x] Hardhat project structure (manually scaffolded — `npx hardhat init`'s interactive wizard doesn't work well non-interactively)
- [x] Install OpenZeppelin contracts, ethers, merkletreejs — pinned to **Hardhat 2.22 + toolbox 5** (Hardhat 3 installed by default initially; reverted — too new, too little tutorial coverage for a fast solo build)
- [x] Hardhat config — note: required `evmVersion: "cancun"` for OZ v5's `mcopy` usage, and Node **22** via nvm (project's `.zshrc` pins global Node to 20 via Homebrew, so every `npm`/`npx` command in this repo needs `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` first — see README)

## Stage 1 — AttesterRegistry.sol ✅
- [x] `registerAttester()` payable, min stake enforced (0.01 ETH)
- [x] `withdrawStake()` — partial (must stay ≥ min stake) or full (deregisters)
- [x] `reputationOf(address)` / `stakeOf(address)` / `isRegistered(address)` views
- [x] `slash()` + `adjustReputation()`, gated to a one-time-configured `slasher` address (DisputeResolution, wired in Stage 5)
- [x] Unit tests: register/withdraw/min-stake/slash-authorization — **11/11 passing**

## Stage 2 — AttestationRegistry.sol ✅
- [x] `issueAttestation(subject, merkleRoot, signature)` — verifies attester is registered in AttesterRegistry AND that `signature` recovers to the calling attester (ECDSA over the EIP-191-prefixed root)
- [x] Attestation record (attester, subject, root, signature, issuedAt, status enum: Active/Disputed/Revoked)
- [x] `verifyDisclosure(attestationId, leaf, proof)` — wraps OZ `MerkleProof.verify`
- [x] `setStatus()` gated to a one-time-configured `disputeResolver` address (wired in Stage 5)
- [x] Unit tests: issue, signature mismatch rejection, valid/invalid/tampered disclosure proofs, status-transition authorization — **8/8 passing**

## Stage 3 — Off-chain crypto (Node script, no UI yet) ✅
- [x] Credential schema: plain `{fieldName: value}` object (employer, role, startDate, endDate, performanceRating, ...)
- [x] `lib/merkleCredential.js` — builds Merkle tree from field-level leaves (`keccak256(fieldName, fieldValue, salt)`, sorted-pair hashing to match OZ), salt per field (not per-credential) to stop brute-forcing low-entropy fields like a numeric rating
- [x] Sign root with attester's key (`signer.signMessage` on raw root bytes → EIP-191, matches contract's `toEthSignedMessageHash`)
- [x] `buildDisclosure()` — selective-disclosure proof for a chosen subset of fields
- [x] Verified standalone via `scripts/offchain-merkle-demo.js` before any contract integration touched it (includes a tamper check to confirm forged values fail)

## Stage 5 — DisputeResolution.sol ✅ (built ahead of Stage 4 frontend — stayed in the Solidity context instead of switching to React and back twice)
- [x] `raiseDispute(attestationId)` — exact bond required, only against an Active attestation, attester can't dispute themselves, flips attestation to Disputed
- [x] Juror pool = any registered attester not party to the dispute; `commitVote` / `revealVote` with `keccak256(vote, salt, sender)` commitments (sender-bound to stop commit-copying)
- [x] `resolveDispute` — tallies revealed votes: attester-majority (bond forfeited to attester, +reputation), disputer-majority (attester slashed 0.05 ETH + −20 reputation, bond refunded to disputer), tie/no-turnout (dismissed, bond forfeited to attester, no reputation change)
- [x] Juror settlement: majority-matching revealers get +10 reputation, committed-but-never-revealed jurors get −5 reputation, honest dissenters are left untouched
- [x] Unit tests: full commit-reveal cycle (both outcomes), non-reveal penalty, tie-break rule, slashing payout correctness, access control (non-attester juror, self-juror, mismatched reveal) — **10/10 passing**

## Stage 4 — Minimal frontend (core flow) ✅
- [x] React + Vite scaffold, MetaMask connect (`frontend/`, `WalletContext.jsx`)
- [x] Attester view: register, issue attestation (form → builds Merkle tree client-side → signs root → submits root+sig on-chain, then shows the shareable credential blob)
- [x] Employee view: import credential blob (localStorage-backed, see Stage 7 note), choose fields to disclose, generate proof bundle
- [x] Verifier view: paste proof bundle, check each field against on-chain root via `verifyDisclosure`, shows attester reputation + attestation status
- [x] Deployment script (`scripts/deploy.js`) — deploys all 3 contracts, wires slasher/disputeResolver permissions, writes addresses for the frontend to consume
- [x] Fixed a real bug hit along the way: `merkletreejs`/`keccak256` expect Node's `Buffer`, which browsers don't have — added `vite-plugin-node-polyfills`

**→ Checkpoint reached: full attest → disclose → verify loop is built end-to-end.**

## Stage 5 — DisputeResolution.sol ✅
(See above — built ahead of Stage 4/6 frontend to stay in the Solidity context.)

## Stage 6 — Frontend for dispute flow ✅
- [x] Raise dispute UI (`DisputesPanel.jsx`) — bond auto-fetched from contract
- [x] Juror UI: commit (vote+salt generated client-side, saved locally so the same browser can reveal later) + reveal
- [x] Resolution display — live dispute state (deadlines, vote tally, resolved flag) via `getDispute`, resolve button

## Stage 7 — Polish (partial)
- [x] README with setup instructions + a scripted demo walkthrough (for presenting to the class)
- [ ] Swap localStorage stub for real IPFS (web3.storage/Pinata) storage of encrypted full credential blob — deliberately deferred, see FEASIBILITY.md
- [ ] Reputation display on Attester profile (currently only shown to the Attester themselves and to Verifiers looking up an attestation; a dedicated profile view is a nice-to-have, not required for the demo)
- [ ] Optional: deploy to Sepolia for a "real network" demo

## Verification status (be upfront about this)
- **Contracts**: fully verified — `npx hardhat test` passes 29/29 across `AttesterRegistry`, `AttestationRegistry`, `DisputeResolution`.
- **Off-chain crypto**: verified standalone (`scripts/offchain-merkle-demo.js`, including a tamper check) and again inside the contract test suite using the exact same `lib/merkleCredential.js`.
- **Frontend**: `npm run build` succeeds cleanly; the dev server serves all modules with no transform errors; contracts were deployed to a local chain and the frontend picked up the addresses correctly. **Not yet click-tested end-to-end in a real browser with MetaMask** (no connected browser automation available this session) — walk through the demo scripts in README.md before presenting, in case a UI wiring bug surfaces that the contract tests wouldn't catch.

## Deliverable docs (this repo)
- `PROBLEM_STATEMENT.md` — the why
- `TECH_STACK.md` — the what, and why not the alternatives
- `FEASIBILITY.md` — risk breakdown + build order rationale
- `PLAN.md` — this file, the task-level checklist + build log
- `README.md` — setup + demo instructions for whoever's grading this
