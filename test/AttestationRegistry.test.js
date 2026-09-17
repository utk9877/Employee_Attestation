const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildCredentialTree, buildDisclosure } = require("../lib/merkleCredential");

describe("AttestationRegistry", function () {
  let attesterRegistry, attestationRegistry, owner, employer, employee, verifier, stranger;
  const MIN_STAKE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, employer, employee, verifier, stranger] = await ethers.getSigners();

    const AttesterRegistry = await ethers.getContractFactory("AttesterRegistry");
    attesterRegistry = await AttesterRegistry.deploy();
    await attesterRegistry.waitForDeployment();

    const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
    attestationRegistry = await AttestationRegistry.deploy(await attesterRegistry.getAddress());
    await attestationRegistry.waitForDeployment();

    await attesterRegistry.connect(employer).registerAttester({ value: MIN_STAKE });
  });

  async function issueSampleAttestation() {
    const credential = {
      employer: "Acme Corp",
      role: "Senior Backend Engineer",
      startDate: "2022-01-15",
      endDate: "2024-06-30",
      performanceRating: "4.8",
    };

    const { tree, root, fields } = buildCredentialTree(credential);
    const signature = await employer.signMessage(ethers.getBytes(root));

    const tx = await attestationRegistry
      .connect(employer)
      .issueAttestation(employee.address, root, signature);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => {
        try {
          return attestationRegistry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "AttestationIssued");
    const attestationId = event.args.attestationId;

    return { attestationId, tree, root, fields };
  }

  describe("issuance", function () {
    it("issues an attestation from a registered, correctly-signed attester", async function () {
      const { attestationId, root } = await issueSampleAttestation();
      const stored = await attestationRegistry.getAttestation(attestationId);

      expect(stored.attester).to.equal(employer.address);
      expect(stored.subject).to.equal(employee.address);
      expect(stored.merkleRoot).to.equal(root);
      expect(stored.status).to.equal(0); // Active
    });

    it("rejects issuance from an unregistered address", async function () {
      const { root, fields } = buildCredentialTree({ role: "X" });
      void fields;
      const signature = await stranger.signMessage(ethers.getBytes(root));

      await expect(
        attestationRegistry.connect(stranger).issueAttestation(employee.address, root, signature)
      ).to.be.revertedWith("AttestationRegistry: attester not registered");
    });

    it("rejects a signature that doesn't match the calling attester", async function () {
      const { root } = buildCredentialTree({ role: "X" });
      // Signed by employee, but submitted as if from employer.
      const badSignature = await employee.signMessage(ethers.getBytes(root));

      await expect(
        attestationRegistry.connect(employer).issueAttestation(employee.address, root, badSignature)
      ).to.be.revertedWith("AttestationRegistry: signature does not match attester");
    });
  });

  describe("selective disclosure", function () {
    it("verifies a valid disclosure of a chosen subset of fields", async function () {
      const { attestationId, tree, fields } = await issueSampleAttestation();

      const disclosed = buildDisclosure(tree, fields, ["role", "startDate", "endDate"]);

      for (const d of disclosed) {
        const valid = await attestationRegistry
          .connect(verifier)
          .verifyDisclosure(attestationId, d.leaf, d.proof);
        expect(valid, `field ${d.fieldName} should verify`).to.equal(true);
      }
    });

    it("does not reveal undisclosed fields via a bogus proof", async function () {
      const { attestationId, tree, fields } = await issueSampleAttestation();

      // Attacker guesses a value for the undisclosed "performanceRating" field
      // without knowing the real salt, and tries to fabricate a leaf/proof.
      const { leafHash } = require("../lib/merkleCredential");
      const guessedLeaf = leafHash("performanceRating", "5.0", ethers.hexlify(ethers.randomBytes(32)));
      const bogusProof = tree.getHexProof(guessedLeaf); // empty/irrelevant proof since leaf isn't in tree

      const valid = await attestationRegistry
        .connect(verifier)
        .verifyDisclosure(attestationId, guessedLeaf, bogusProof);
      expect(valid).to.equal(false);
    });

    it("rejects a tampered field value reusing the real proof", async function () {
      const { attestationId, tree, fields } = await issueSampleAttestation();
      const [disclosed] = buildDisclosure(tree, fields, ["role"]);

      const { leafHash } = require("../lib/merkleCredential");
      const tamperedLeaf = leafHash("role", "Staff Engineer", disclosed.salt);

      const valid = await attestationRegistry
        .connect(verifier)
        .verifyDisclosure(attestationId, tamperedLeaf, disclosed.proof);
      expect(valid).to.equal(false);
    });
  });

  describe("status transitions", function () {
    it("rejects setStatus from anyone but the dispute resolver", async function () {
      const { attestationId } = await issueSampleAttestation();
      await expect(
        attestationRegistry.connect(stranger).setStatus(attestationId, 1)
      ).to.be.revertedWith("AttestationRegistry: caller is not the dispute resolver");
    });

    it("allows the configured dispute resolver to change status", async function () {
      await attestationRegistry.connect(owner).setDisputeResolver(stranger.address);
      const { attestationId } = await issueSampleAttestation();

      await expect(attestationRegistry.connect(stranger).setStatus(attestationId, 1))
        .to.emit(attestationRegistry, "AttestationStatusChanged")
        .withArgs(attestationId, 1);

      const stored = await attestationRegistry.getAttestation(attestationId);
      expect(stored.status).to.equal(1); // Disputed
    });
  });
});
