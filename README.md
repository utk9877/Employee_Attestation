# VeriRef

Decentralized Employment Attestation & Verification Network — see `PROBLEM_STATEMENT.md` for the
full pitch, `TECH_STACK.md` for stack rationale, `FEASIBILITY.md` for risk analysis, and `PLAN.md`
for the build log / checklist.

## One-time setup notes (read this first)

This machine's global Node (via `~/.zshrc`) is pinned to **Node 20** for another project, but
**Hardhat 3+ requires Node ≥ 22**. Rather than change the global pin, this project uses Node 22
scoped via `nvm` (see `.nvmrc`). Every terminal command below assumes:

```bash
export NVM_DIR="$HOME/.nvm"
export PATH="$NVM_DIR/versions/node/v22.23.2/bin:$PATH"
```

Run that once per terminal session before any `npm`/`npx` command in this repo (or `nvm use` if
your shell's nvm integration picks it up correctly — this machine's didn't, due to the `.zshrc`
override happening after nvm init).

Also: **port 8545** (Hardhat's usual default) is already used by an unrelated project on this
machine, so this project's local chain runs on **port 8546** instead (`hardhat.config.js`'s
`localhost` network points there).

## Install

```bash
npm install                 # root: contracts
cd frontend && npm install  # frontend: React app
```

## Run the contracts (tests)

```bash
npx hardhat compile
npx hardhat test            # 29 tests across all 3 contracts
npx hardhat run scripts/offchain-merkle-demo.js   # standalone selective-disclosure crypto demo
```

## Run the full app locally

Three terminals (each needs the Node 22 PATH export above):

```bash
# Terminal 1 — local chain
npx hardhat node --port 8546

# Terminal 2 — deploy contracts + wire permissions (writes addresses for the frontend)
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3 — frontend
cd frontend && npm run dev
```

Then open http://localhost:5173.

### MetaMask setup (for the demo)

1. Add a custom network: RPC URL `http://127.0.0.1:8546`, chain ID `31337`.
2. Import a couple of the test accounts Hardhat prints on startup (their private keys are logged
   to the terminal — they're publicly known test keys, never use them anywhere real).
3. Use one account as the **employer/attester**, a different one as the **employee**, and (for
   testing disputes) a couple more as **jurors**.

### Demo script (attest → disclose → verify)

1. **Attester tab**: connect as the employer account, register (stakes 0.01 ETH), fill in
   credential fields (role, dates, rating, ...), enter the employee's address, issue the
   attestation. Copy the resulting JSON blob.
2. **Employee tab**: switch MetaMask to the employee account, paste the blob into "Import a
   credential". Check the boxes for only the fields you want to prove (e.g. role + dates, not
   rating), click "Generate Selective Disclosure". Copy that JSON bundle.
3. **Verifier tab**: paste the disclosure bundle, click Verify — see the attester's on-chain
   reputation, the attestation status, and each disclosed field cryptographically verified against
   the on-chain Merkle root, with no other field ever revealed.

### Demo script (dispute)

1. **Disputes tab**, as the employee: raise a dispute against the attestation ID (pays the 0.02 ETH
   bond).
2. Switch to juror accounts (must already be registered attesters) and commit a vote each.
3. Wait past the 1-hour commit window (or shrink `COMMIT_DURATION`/`REVEAL_DURATION` in
   `DisputeResolution.sol` for a faster local demo), then reveal each vote.
4. Wait past the reveal window, then resolve — watch the attester get slashed/rewarded and jurors'
   reputations update accordingly.

## What's stubbed vs. real (be upfront about this in your presentation)

- **Real**: all on-chain logic — staking, slashing, Merkle-proof selective disclosure, ECDSA
  signature verification, commit-reveal jury voting. Fully unit-tested (29/29).
- **Stubbed for MVP speed**: the "share this blob with the employee" step is manual copy/paste
  (localStorage-backed) instead of encrypted IPFS delivery — this is a deliberate, documented
  scope decision (see `FEASIBILITY.md`), not an oversight. Swapping in real IPFS storage later
  doesn't touch any contract or crypto logic.

## Project layout

```
contracts/            AttesterRegistry.sol, AttestationRegistry.sol, DisputeResolution.sol
test/                 Hardhat/Mocha tests (29 passing)
lib/merkleCredential.js   Off-chain selective-disclosure crypto (Node/CJS, used by tests+scripts)
scripts/               deploy.js, offchain-merkle-demo.js
frontend/              React + Vite app (ethers.js, MetaMask)
  src/lib/merkleCredential.js   Browser copy (ESM) of the same crypto
  src/lib/contracts.js          Contract addresses/ABIs/ethers wiring
  src/context/WalletContext.jsx MetaMask connection state
  src/components/                AttesterPanel, EmployeePanel, VerifierPanel, DisputesPanel
```
