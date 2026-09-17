// Deploys all three VeriRef contracts and wires the cross-contract permissions:
//   AttesterRegistry.slasher          -> DisputeResolution
//   AttestationRegistry.disputeResolver -> DisputeResolution
//
// Usage: npx hardhat run scripts/deploy.js --network <network>

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const AttesterRegistry = await ethers.getContractFactory("AttesterRegistry");
  const attesterRegistry = await AttesterRegistry.deploy();
  await attesterRegistry.waitForDeployment();
  console.log("AttesterRegistry deployed to:", await attesterRegistry.getAddress());

  const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
  const attestationRegistry = await AttestationRegistry.deploy(await attesterRegistry.getAddress());
  await attestationRegistry.waitForDeployment();
  console.log("AttestationRegistry deployed to:", await attestationRegistry.getAddress());

  const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
  const disputeResolution = await DisputeResolution.deploy(
    await attesterRegistry.getAddress(),
    await attestationRegistry.getAddress()
  );
  await disputeResolution.waitForDeployment();
  console.log("DisputeResolution deployed to:", await disputeResolution.getAddress());

  await (await attesterRegistry.setSlasher(await disputeResolution.getAddress())).wait();
  await (await attestationRegistry.setDisputeResolver(await disputeResolution.getAddress())).wait();
  console.log("Wired slasher + disputeResolver permissions.");

  const addresses = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    AttesterRegistry: await attesterRegistry.getAddress(),
    AttestationRegistry: await attestationRegistry.getAddress(),
    DisputeResolution: await disputeResolution.getAddress(),
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("Wrote deployed addresses to", outPath);

  const frontendConfigDir = path.join(__dirname, "..", "frontend", "src", "config");
  if (fs.existsSync(frontendConfigDir)) {
    const frontendOutPath = path.join(frontendConfigDir, "addresses.json");
    fs.writeFileSync(frontendOutPath, JSON.stringify(addresses, null, 2));
    console.log("Wrote deployed addresses to", frontendOutPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
