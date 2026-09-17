// Stage 3: validate the selective-disclosure crypto standalone, no contracts involved.
// Run with: npx hardhat run scripts/offchain-merkle-demo.js

const { buildCredentialTree, buildDisclosure, verifyDisclosureOffchain } = require("../lib/merkleCredential");

function main() {
  const credential = {
    employer: "Acme Corp",
    role: "Senior Backend Engineer",
    startDate: "2022-01-15",
    endDate: "2024-06-30",
    performanceRating: "4.8",
    salaryBand: "L5", // deliberately sensitive/undisclosed in this demo
  };

  console.log("Full (private) credential:", credential);

  const { tree, root, fields } = buildCredentialTree(credential);
  console.log("\nPublic commitment (this is all that would go on-chain): merkleRoot =", root);

  // Employee chooses to prove only role + tenure, hiding rating and salary band.
  const disclosed = buildDisclosure(tree, fields, [
    "employer",
    "role",
    "startDate",
    "endDate",
  ]);

  console.log("\nSelectively disclosed fields (shared with a verifier):");
  for (const d of disclosed) {
    console.log(`  ${d.fieldName} = ${d.fieldValue}`);
  }

  console.log("\nVerifying each disclosed field against the public root...");
  let allValid = true;
  for (const d of disclosed) {
    const valid = verifyDisclosureOffchain(root, d);
    console.log(`  ${d.fieldName}: ${valid ? "VALID" : "INVALID"}`);
    if (!valid) allValid = false;
  }

  // Sanity check: tampering with a disclosed value must break verification.
  const tampered = { ...disclosed[1], fieldValue: "Staff Engineer" };
  const tamperedValid = verifyDisclosureOffchain(root, tampered);
  console.log(`\nTamper check (role changed to "Staff Engineer" without new salt): ${tamperedValid ? "VALID (BUG!)" : "INVALID (expected)"}`);

  if (allValid && !tamperedValid) {
    console.log("\n✅ Off-chain selective disclosure crypto behaves correctly.");
  } else {
    console.log("\n❌ Something is wrong with the disclosure logic.");
    process.exitCode = 1;
  }
}

main();
