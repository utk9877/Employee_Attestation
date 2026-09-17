# Tech Stack

Chosen for build speed (solo, fast timeline) while still hitting every course-relevant concept.

## Smart contracts
- **Solidity** (^0.8.x)
- **Hardhat** — dev environment, local chain, deployment scripts, testing. Chosen over Foundry for the much larger volume of JS-integration tutorials (matters more than raw compile speed when you're moving fast solo and may need to unblock yourself quickly), and over Hyperledger Fabric because permissioned-network setup/ops overhead is not worth it for a solo fast build.
- **OpenZeppelin Contracts** — `MerkleProof.sol`, `ReentrancyGuard`, `Ownable`, `ECDSA.sol` — don't hand-roll primitives that are a known source of subtle bugs.
- Local network: Hardhat Network (instant, deterministic, free test accounts). Optional final deploy to **Sepolia testnet** for demo credibility.

## Contracts (planned)
- `AttesterRegistry.sol` — register as attester, stake/withdraw, reputation score, slashing hook.
- `AttestationRegistry.sol` — anchor `(attester, subject, merkleRoot, signature, timestamp)`, mark revoked/disputed.
- `DisputeResolution.sol` — raise dispute (bonded), juror commit-reveal voting, resolve + slash.

## Off-chain / crypto
- **merkletreejs + keccak256** (via `ethers`/`js-sha3`) — build the Merkle tree of attestation fields client-side; generate/verify selective-disclosure proofs.
- **ethers.js** — signing, contract calls, wallet interaction.
- **IPFS** via **web3.storage** (or Pinata) — store the *encrypted* full credential blob; only the employee holds the decryption key. On-chain only stores the Merkle root + a content hash pointer.

## Frontend
- **React + Vite** — fast dev loop, minimal boilerplate.
- **MetaMask** for wallet connection/signing.
- Three simple views: Attester dashboard, Employee/Holder wallet, Verifier lookup page.

## Testing
- Hardhat + Mocha/Chai for contract unit tests (staking edge cases, Merkle proof verification, commit-reveal timing/slashing logic).

## Explicitly not used (and why)
- **zk-SNARKs (circom/snarkjs)** — same disclosure guarantee achievable via Merkle proofs for this use case at a fraction of the build time; noted as future work.
- **Hyperledger Fabric** — permissioning/ops overhead not justified for a solo project on a deadline; Ethereum's own validator consensus already demonstrates the "distributed agreement" course concept, and the jury commit-reveal contract adds a second, bespoke consensus mechanism on top.
- **Custom from-scratch chain (Python/Go + hand-rolled PBFT/Raft)** — would be the most "distributed systems pure" option, but is the slowest to build correctly; ruled out given the "as fast as possible" constraint.
