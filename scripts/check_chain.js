const { ethers } = require("hardhat");

async function main() {
  const addresses = require("../frontend/src/config/addresses.json");
  console.log("Addresses:", addresses);
  const attestationReg = await ethers.getContractAt("AttestationRegistry", addresses.AttestationRegistry);
  const count = await attestationReg.nextAttestationId();
  console.log("nextAttestationId:", count.toString());
  for (let i = 0; i < count; i++) {
    const a = await attestationReg.getAttestation(i);
    console.log(`Attestation #${i}: attester=${a.attester}, subject=${a.subject}, root=${a.merkleRoot}, status=${a.status}`);
  }
}
main().catch(console.error);
