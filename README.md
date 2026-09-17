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

### Demo script (attest → auto-discover → disclose → verify)

1. **Attester tab**:
   - Connect employer account, register (stakes 0.01 ETH).
   - Fill in attributes (role, dates, rating). Keep *Generate Zero-Knowledge Range Predicates* and *On-Chain Encrypted Vault* checked.
   - Set an optional validity duration (e.g. 1 Year).
   - Enter employee address and click "Sign & Anchor Attestation".
2. **Employee tab**:
   - Switch MetaMask to the employee account.
   - Notice the green notification: **"📬 On-Chain Credentials Detected!"**.
   - Click **"Auto-Sync & Decrypt"** — your credentials appear instantly with zero manual JSON copy-pasting!
   - Choose what to disclose: pick attributes or check **🛡️ Privacy Preset (Predicates Only)** to prove milestones like `Performance Rating ≥ 4.0` without revealing exact numbers.
   - Enter the verifier's address (or leave blank) and click **"Sign & Generate Presentation"** (prompts an EIP-712 wallet signature to prove wallet ownership and stop replay attacks).
   - Click **"🔗 Copy Direct Verifier Link"** or copy the presentation package.
3. **Verifier tab**:
   - Paste the presentation package (or open via direct link).
   - See on-chain validation:
     - ✅ **Merkle Proofs**: Each disclosed attribute/predicate verified against root.
     - ✅ **Subject Identity**: EIP-712 challenge signature verified matching employee wallet.
     - ✅ **Trust Signals**: Employer collateral, reputation score, and expiration window.
4. **Directory & Trust tab**:
   - View public ranking of all registered employers, stakes, reputation scores, and trust tiers.

### Demo script (dispute & revocation)

1. **Voluntary Revocation (Attester tab)**:
   - Employer can manage issued attestations and revoke one directly with an on-chain reason (e.g. "Terminated for policy breach").
   - When verified, the Verifier tab immediately flags it with an alert.
2. **Disputes tab (Employee / Jurors)**:
   - Employee raises a dispute against an attestation (0.02 ETH bond).
   - Registered attesters act as jurors and cast commit-reveal votes.
   - Settle dispute: dishonest attesters are slashed 0.05 ETH and lose reputation; honest jurors gain reputation.

## Novel Architectural Features (Academic Rationale)

1. **Zero-Knowledge Range & Threshold Predicates**:
   - Solves the real-world privacy dilemma: employees can prove `Performance Rating ≥ 4.0/5.0` or `Tenure ≥ 24 Months` without revealing sensitive exact scores or dates.
2. **EIP-712 Verifiable Presentation (VP) Protocol**:
   - Solves the credential theft / replay vulnerability present in naive blockchain credential projects. Verifier challenges ensure only the legitimate subject wallet owner can present the proof bundle.
3. **On-Chain Encrypted Vault (Zero Copy-Paste Delivery)**:
   - WebCrypto AES-GCM encryption binds payloads to employee wallets and emits them in indexed events, enabling seamless auto-discovery.
4. **Full Lifecycle Management**:
   - Expiration timestamps (`validUntil`) and employer voluntary revocation with verifiable audit trails.
5. **Public Attester Reputation Leaderboard**:
   - Transparent directory displaying staked collateral, reputation rankings, and trust tiers.

## Project layout

```
contracts/            AttesterRegistry.sol, AttestationRegistry.sol, DisputeResolution.sol
test/                 Hardhat/Mocha tests (34 passing)
  AttestationRegistry.test.js
  AttesterRegistry.test.js
  DisputeResolution.test.js
  NovelFeatures.test.js   (lifecycle, ZK predicates, EIP-712 VP replay protection)
lib/merkleCredential.js   Off-chain selective-disclosure crypto & EIP-712 VP signer (Node/CJS)
scripts/               deploy.js, offchain-merkle-demo.js
frontend/              React + Vite app (ethers.js, MetaMask)
  src/lib/merkleCredential.js   Browser ESM copy of crypto & EIP-712 VP protocol
  src/lib/cryptoVault.js        Browser WebCrypto AES-GCM auto-discovery vault
  src/lib/contracts.js          Contract addresses/ABIs/ethers wiring
  src/context/WalletContext.jsx MetaMask connection state
  src/components/
    AttesterPanel.jsx           Employer issuance, lifecycle expiry, revocation
    EmployeePanel.jsx           Auto-discovery inbox, threshold selector, VP signer
    VerifierPanel.jsx           Dual-layer verification (Merkle + VP challenge), badges
    DisputesPanel.jsx           Commit-reveal jury dispute resolution
    LeaderboardPanel.jsx        Public employer directory and reputation leaderboard
```
