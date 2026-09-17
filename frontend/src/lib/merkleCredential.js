// Browser copy of ../../../lib/merkleCredential.js (ESM instead of CJS for Vite).
// Kept as a duplicate rather than a shared package for MVP simplicity — see
// PLAN.md Stage 7 if this needs to become a real shared workspace package.

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

export function buildCredentialTree(credential) {
  const fields = Object.entries(credential).map(([fieldName, fieldValue]) => {
    const salt = randomSalt();
    return { fieldName, fieldValue: String(fieldValue), salt, leaf: leafHash(fieldName, fieldValue, salt) };
  });

  const leaves = fields.map((f) => Buffer.from(f.leaf.slice(2), "hex"));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  return { tree, root: tree.getHexRoot(), fields };
}

// Rebuild a MerkleTree from previously-computed leaves (e.g. after loading a
// credential back out of localStorage) without needing to regenerate salts.
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
