// Browser copy of ../../../lib/merkleCredential.js (ESM instead of CJS for Vite).

import { ethers } from "ethers";
import { Buffer } from "buffer";
import { MerkleTree } from "merkletreejs";

// Use ethers' browser-safe Keccak implementation instead of the Node-oriented
// keccak256 package, which can receive an undefined Buffer in Vite builds.
function keccak256(value) {
  return Buffer.from(ethers.keccak256(value).slice(2), "hex");
}

export function randomSalt() {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function leafHash(fieldName, fieldValue, salt) {
  return ethers.solidityPackedKeccak256(
    ["string", "string", "bytes32"],
    [fieldName, String(fieldValue), salt]
  );
}

/**
 * Derive zero-knowledge range/threshold predicate claims from raw numeric and date fields.
 */
export function derivePredicates(credential) {
  const predicates = {};

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

export function buildCredentialTree(credential, options = {}) {
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

// Rebuild a MerkleTree from previously-computed leaves (e.g. after loading a
// credential back out of storage) without needing to regenerate salts.
export function rebuildTree(fields) {
  const leaves = fields.map((f) => Buffer.from(f.leaf.slice(2), "hex"));
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

export function buildDisclosure(tree, fields, fieldNamesToDisclose) {
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

export function verifyDisclosureOffchain(root, disclosedField) {
  const recomputedLeaf = leafHash(disclosedField.fieldName, disclosedField.fieldValue, disclosedField.salt);
  if (recomputedLeaf !== disclosedField.leaf) return false;

  const leafBuf = Buffer.from(disclosedField.leaf.slice(2), "hex");
  const proofBufs = disclosedField.proof.map((p) => Buffer.from(p.slice(2), "hex"));
  const rootBuf = Buffer.from(root.slice(2), "hex");

  return MerkleTree.verify(proofBufs, leafBuf, rootBuf, keccak256, { sortPairs: true });
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

export function hashDisclosedLeaves(disclosed) {
  if (!disclosed || disclosed.length === 0) return ethers.ZeroHash;
  const leafBytes = ethers.concat(disclosed.map((d) => ethers.getBytes(d.leaf)));
  return ethers.keccak256(leafBytes);
}

export async function signVerifiablePresentation(
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

export function verifyPresentationSignature(
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

