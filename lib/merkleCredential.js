// Off-chain Merkle-credential helpers shared by tests, scripts, and (later) the frontend.
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
 * @param {Record<string,string>} credential
 * @returns {{
 *   tree: MerkleTree,
 *   root: string,
 *   fields: Array<{ fieldName: string, fieldValue: string, salt: string, leaf: string }>
 * }}
 */
function buildCredentialTree(credential) {
  const fields = Object.entries(credential).map(([fieldName, fieldValue]) => {
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

module.exports = {
  buildCredentialTree,
  buildDisclosure,
  verifyDisclosureOffchain,
  leafHash,
  randomSalt,
  rebuildTree,
};
