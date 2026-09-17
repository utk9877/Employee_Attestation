// Off-chain Merkle-credential helpers shared by tests, scripts, and the frontend.
//
// A credential is a plain object of field name -> field value, e.g.:
//   { role: "Senior Engineer", startDate: "2022-01-01", endDate: "2024-06-30", rating: "4.8" }
//
// Each field becomes its own leaf: keccak256(fieldName, fieldValue, salt). The salt is
// required per-field (not just per-credential) so low-entropy fields (e.g. a rating out
// of 5) can't be brute-forced from the public root by an outside observer who only sees
// on-chain data — without the salt, trying all plausible "rating" values against the
// root would leak the field even without an explicit disclosure.
//
// The Merkle tree is built with sorted-pair hashing to match OpenZeppelin's
// MerkleProof.verify, which assumes sorted pairs.

const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

function randomSalt() {
  return ethers.hexlify(ethers.randomBytes(32));
}

function leafHash(fieldName, fieldValue, salt) {
  return ethers.solidityPackedKeccak256(
    ["string", "string", "bytes32"],
    [fieldName, String(fieldValue), salt]
  );
}

/**
 * Derive zero-knowledge range/threshold predicate claims from raw numeric and date fields.
 * This allows employees to prove "Rating >= 4.0" or "Tenure >= 2 Years" without disclosing
 * their exact score, start/end dates, or compensation.
 */
function derivePredicates(credential) {
  const predicates = {};

  // 1. Performance rating thresholds
  const ratingVal = credential.performanceRating || credential.rating;
  if (ratingVal !== undefined && ratingVal !== "") {
    const r = parseFloat(ratingVal);
    if (!isNaN(r)) {
      const thresholds = [3.0, 3.5, 4.0, 4.5, 4.8];
      for (const t of thresholds) {
        predicates[`predicate:rating_gte_${t.toFixed(1)}`] = r >= t ? "true" : "false";
      }
    }
  }

  // 2. Tenure thresholds (calculated from startDate and endDate)
  if (credential.startDate) {
    const start = new Date(credential.startDate);
    const end = (credential.endDate && credential.endDate.toLowerCase() !== "present")
      ? new Date(credential.endDate)
      : new Date();

    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
      const months = Math.floor((end - start) / (1000 * 60 * 60 * 24 * 30.4375));
      const milestones = [6, 12, 24, 36, 48, 60];
      for (const m of milestones) {
        predicates[`predicate:tenure_months_gte_${m}`] = months >= m ? "true" : "false";
      }
    }
  }

  return predicates;
}

/**
 * @param {Record<string,string>} credential
 * @param {{ includePredicates?: boolean }} [options]
 * @returns {{
 *   tree: MerkleTree,
 *   root: string,
 *   fields: Array<{ fieldName: string, fieldValue: string, salt: string, leaf: string }>
 * }}
 */
function buildCredentialTree(credential, options = {}) {
  const merged = { ...credential };
  if (options.includePredicates !== false) {
    const predicates = derivePredicates(credential);
    Object.assign(merged, predicates);
  }

  const fields = Object.entries(merged).map(([fieldName, fieldValue]) => {
    const salt = randomSalt();
    return { fieldName, fieldValue: String(fieldValue), salt, leaf: leafHash(fieldName, fieldValue, salt) };
  });

  const leaves = fields.map((f) => Buffer.from(f.leaf.slice(2), "hex"));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  return { tree, root: tree.getHexRoot(), fields };
}

/**
 * Build a selective-disclosure proof bundle for a chosen subset of field names.
 * Only the chosen fields' values (+ salts) are revealed; the rest stay hidden.
 */
function buildDisclosure(tree, fields, fieldNamesToDisclose) {
  return fieldNamesToDisclose.map((fieldName) => {
    const field = fields.find((f) => f.fieldName === fieldName);
    if (!field) throw new Error(`Unknown field: ${fieldName}`);
    const proof = tree.getHexProof(field.leaf);
    return {
      fieldName: field.fieldName,
      fieldValue: field.fieldValue,
      salt: field.salt,
      leaf: field.leaf,
      proof,
    };
  });
}

/** Recompute the leaf from disclosed (fieldName, fieldValue, salt) and verify it against the root. */
function verifyDisclosureOffchain(root, disclosedField) {
  const recomputedLeaf = leafHash(disclosedField.fieldName, disclosedField.fieldValue, disclosedField.salt);
  if (recomputedLeaf !== disclosedField.leaf) return false;

  const leafBuf = Buffer.from(disclosedField.leaf.slice(2), "hex");
  const proofBufs = disclosedField.proof.map((p) => Buffer.from(p.slice(2), "hex"));
  const rootBuf = Buffer.from(root.slice(2), "hex");

  return MerkleTree.verify(proofBufs, leafBuf, rootBuf, keccak256, { sortPairs: true });
}

function rebuildTree(fields) {
  const leaves = fields.map((f) => Buffer.from(f.leaf.slice(2), "hex"));
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

// --- EIP-712 Verifiable Presentation (VP) Challenge-Response Protocol ---

const VP_TYPES = {
  Presentation: [
    { name: "verifier", type: "address" },
    { name: "nonce", type: "string" },
    { name: "attestationId", type: "uint256" },
    { name: "disclosedHash", type: "bytes32" },
    { name: "timestamp", type: "uint256" },
  ],
};

function hashDisclosedLeaves(disclosed) {
  if (!disclosed || disclosed.length === 0) return ethers.ZeroHash;
  const leafBytes = ethers.concat(disclosed.map((d) => ethers.getBytes(d.leaf)));
  return ethers.keccak256(leafBytes);
}

/**
 * Subject signs a Verifiable Presentation challenge issued by a verifier.
 * Proves that the presenter controls the subject wallet and binds the presentation
 * to this specific verifier and nonce, stopping replay/credential theft attacks.
 */
async function signVerifiablePresentation(
  signer,
  { verifier, nonce, attestationId, disclosed, chainId = 31337, verifyingContract }
) {
  const disclosedHash = hashDisclosedLeaves(disclosed);
  const timestamp = Math.floor(Date.now() / 1000);

  const domain = {
    name: "VeriRef Presentation",
    version: "1",
    chainId: Number(chainId),
    ...(verifyingContract ? { verifyingContract } : {}),
  };

  const message = {
    verifier: ethers.getAddress(verifier),
    nonce: String(nonce),
    attestationId: BigInt(attestationId),
    disclosedHash,
    timestamp: BigInt(timestamp),
  };

  const signature = await signer.signTypedData(domain, VP_TYPES, message);

  return {
    verifier: ethers.getAddress(verifier),
    nonce: String(nonce),
    attestationId: Number(attestationId),
    timestamp,
    disclosedHash,
    signature,
  };
}

/**
 * Verifier validates that the presentation signature was generated by expectedSubject
 * for this verifier and hasn't been tampered with or replayed.
 */
function verifyPresentationSignature(
  presentation,
  expectedSubject,
  disclosed,
  { chainId = 31337, verifyingContract, maxAgeSeconds = 86400, attestationId } = {}
) {
  const expectedHash = hashDisclosedLeaves(disclosed);
  if (presentation.disclosedHash && presentation.disclosedHash !== expectedHash) {
    return { valid: false, reason: "Disclosed fields hash does not match presentation" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (maxAgeSeconds && Math.abs(now - presentation.timestamp) > maxAgeSeconds) {
    return { valid: false, reason: "Presentation timestamp has expired" };
  }

  const resolvedAttestationId = attestationId !== undefined ? attestationId : presentation.attestationId;
  if (resolvedAttestationId === undefined) {
    return { valid: false, reason: "Missing attestationId for presentation verification" };
  }

  const domain = {
    name: "VeriRef Presentation",
    version: "1",
    chainId: Number(chainId),
    ...(verifyingContract ? { verifyingContract } : {}),
  };

  const message = {
    verifier: ethers.getAddress(presentation.verifier),
    nonce: String(presentation.nonce),
    attestationId: BigInt(resolvedAttestationId),
    disclosedHash: expectedHash,
    timestamp: BigInt(presentation.timestamp),
  };

  try {
    const recovered = ethers.verifyTypedData(domain, VP_TYPES, message, presentation.signature);
    if (recovered.toLowerCase() !== expectedSubject.toLowerCase()) {
      return {
        valid: false,
        reason: `Signer (${recovered}) does not match credential subject (${expectedSubject})`,
      };
    }
    return { valid: true, recoveredSigner: recovered };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

module.exports = {
  buildCredentialTree,
  buildDisclosure,
  verifyDisclosureOffchain,
  leafHash,
  randomSalt,
  rebuildTree,
  derivePredicates,
  hashDisclosedLeaves,
  signVerifiablePresentation,
  verifyPresentationSignature,
};

