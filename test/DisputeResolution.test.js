const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { buildCredentialTree } = require("../lib/merkleCredential");

describe("DisputeResolution", function () {
  let attesterRegistry, attestationRegistry, disputeResolution;
  let owner, employer, employee, jurorA, jurorB, jurorC, outsider;
  const MIN_STAKE = ethers.parseEther("0.01");
  const DISPUTE_BOND = ethers.parseEther("0.02");

  beforeEach(async function () {
    [owner, employer, employee, jurorA, jurorB, jurorC, outsider] = await ethers.getSigners();

    const AttesterRegistry = await ethers.getContractFactory("AttesterRegistry");
    attesterRegistry = await AttesterRegistry.deploy();
    await attesterRegistry.waitForDeployment();

    const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
    attestationRegistry = await AttestationRegistry.deploy(await attesterRegistry.getAddress());
    await attestationRegistry.waitForDeployment();

    const DisputeResolution = await ethers.getContractFactory("DisputeResolution");
    disputeResolution = await DisputeResolution.deploy(
      await attesterRegistry.getAddress(),
      await attestationRegistry.getAddress()
    );
    await disputeResolution.waitForDeployment();

    await attesterRegistry.connect(owner).setSlasher(await disputeResolution.getAddress());
    await attestationRegistry.connect(owner).setDisputeResolver(await disputeResolution.getAddress());

    // Employer + three jurors all stake generously so slashing tests have headroom.
    for (const signer of [employer, jurorA, jurorB, jurorC]) {
      await attesterRegistry.connect(signer).registerAttester({ value: MIN_STAKE * 10n });
    }
  });

  async function issueSampleAttestation() {
    const { root, fields } = buildCredentialTree({ role: "Engineer", startDate: "2022-01-01" });
    void fields;
    const signature = await employer.signMessage(ethers.getBytes(root));
    const tx = await attestationRegistry.connect(employer).issueAttestation(employee.address, root, signature);
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
    return event.args.attestationId;
  }

  function commitFor(vote, salt, jurorAddress) {
    return ethers.solidityPackedKeccak256(["bool", "bytes32", "address"], [vote, salt, jurorAddress]);
  }

  const SALT_A = ethers.hexlify(ethers.randomBytes(32));
  const SALT_B = ethers.hexlify(ethers.randomBytes(32));
  const SALT_C = ethers.hexlify(ethers.randomBytes(32));

  describe("raising a dispute", function () {
    it("requires the exact bond and an active attestation", async function () {
      const attestationId = await issueSampleAttestation();

      await expect(
        disputeResolution.connect(employee).raiseDispute(attestationId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("DisputeResolution: incorrect bond");

      await expect(
        disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND })
      )
        .to.emit(disputeResolution, "DisputeRaised")
        .withArgs(0, attestationId, employee.address, employer.address);

      const attestation = await attestationRegistry.getAttestation(attestationId);
      expect(attestation.status).to.equal(1); // Disputed
    });

    it("rejects the attester disputing themselves", async function () {
      const attestationId = await issueSampleAttestation();
      await expect(
        disputeResolution.connect(employer).raiseDispute(attestationId, { value: DISPUTE_BOND })
      ).to.be.revertedWith("DisputeResolution: attester cannot dispute themselves");
    });
  });

  describe("full commit-reveal cycle", function () {
    it("resolves in the attester's favor when the majority votes the attestation valid", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      // 2 vote "valid" (true), 1 votes "fraudulent" (false).
      await disputeResolution.connect(jurorA).commitVote(0, commitFor(true, SALT_A, jurorA.address));
      await disputeResolution.connect(jurorB).commitVote(0, commitFor(true, SALT_B, jurorB.address));
      await disputeResolution.connect(jurorC).commitVote(0, commitFor(false, SALT_C, jurorC.address));

      await time.increase(3600 + 1); // past commit deadline

      await disputeResolution.connect(jurorA).revealVote(0, true, SALT_A);
      await disputeResolution.connect(jurorB).revealVote(0, true, SALT_B);
      await disputeResolution.connect(jurorC).revealVote(0, false, SALT_C);

      await time.increase(3600 + 1); // past reveal deadline

      const employerBalanceBefore = await ethers.provider.getBalance(employer.address);

      await expect(disputeResolution.resolveDispute(0))
        .to.emit(disputeResolution, "DisputeResolved")
        .withArgs(0, 2 /* AttesterWon */, 2, 1);

      const attestation = await attestationRegistry.getAttestation(attestationId);
      expect(attestation.status).to.equal(0); // back to Active

      // Attester received the forfeited bond.
      const employerBalanceAfter = await ethers.provider.getBalance(employer.address);
      expect(employerBalanceAfter - employerBalanceBefore).to.equal(DISPUTE_BOND);

      // Attester reputation rewarded, stake untouched.
      expect(await attesterRegistry.reputationOf(employer.address)).to.equal(110n);
      expect(await attesterRegistry.stakeOf(employer.address)).to.equal(MIN_STAKE * 10n);

      // Majority jurors (A, B) rewarded; dissenting juror (C) untouched.
      expect(await attesterRegistry.reputationOf(jurorA.address)).to.equal(110n);
      expect(await attesterRegistry.reputationOf(jurorB.address)).to.equal(110n);
      expect(await attesterRegistry.reputationOf(jurorC.address)).to.equal(100n);
    });

    it("resolves in the disputer's favor when the majority votes fraudulent, slashing the attester", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await disputeResolution.connect(jurorA).commitVote(0, commitFor(false, SALT_A, jurorA.address));
      await disputeResolution.connect(jurorB).commitVote(0, commitFor(false, SALT_B, jurorB.address));
      await disputeResolution.connect(jurorC).commitVote(0, commitFor(true, SALT_C, jurorC.address));

      await time.increase(3600 + 1);
      await disputeResolution.connect(jurorA).revealVote(0, false, SALT_A);
      await disputeResolution.connect(jurorB).revealVote(0, false, SALT_B);
      await disputeResolution.connect(jurorC).revealVote(0, true, SALT_C);
      await time.increase(3600 + 1);

      const disputerBalanceBefore = await ethers.provider.getBalance(employee.address);
      const stakeBefore = await attesterRegistry.stakeOf(employer.address);

      await expect(disputeResolution.resolveDispute(0))
        .to.emit(disputeResolution, "DisputeResolved")
        .withArgs(0, 3 /* DisputerWon */, 1, 2);

      const attestation = await attestationRegistry.getAttestation(attestationId);
      expect(attestation.status).to.equal(2); // Revoked

      const disputerBalanceAfter = await ethers.provider.getBalance(employee.address);
      expect(disputerBalanceAfter - disputerBalanceBefore).to.equal(DISPUTE_BOND);

      const stakeAfter = await attesterRegistry.stakeOf(employer.address);
      expect(stakeBefore - stakeAfter).to.equal(ethers.parseEther("0.05")); // SLASH_AMOUNT
      expect(await attesterRegistry.reputationOf(employer.address)).to.equal(80n); // 100 - 20

      expect(await attesterRegistry.reputationOf(jurorA.address)).to.equal(110n);
      expect(await attesterRegistry.reputationOf(jurorB.address)).to.equal(110n);
      expect(await attesterRegistry.reputationOf(jurorC.address)).to.equal(100n);
    });
  });

  describe("non-reveal penalty", function () {
    it("penalizes a juror who commits but never reveals", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await disputeResolution.connect(jurorA).commitVote(0, commitFor(true, SALT_A, jurorA.address));
      await disputeResolution.connect(jurorB).commitVote(0, commitFor(true, SALT_B, jurorB.address));
      // jurorC commits but will never reveal.
      await disputeResolution.connect(jurorC).commitVote(0, commitFor(false, SALT_C, jurorC.address));

      await time.increase(3600 + 1);
      await disputeResolution.connect(jurorA).revealVote(0, true, SALT_A);
      await disputeResolution.connect(jurorB).revealVote(0, true, SALT_B);
      await time.increase(3600 + 1);

      await disputeResolution.resolveDispute(0);

      expect(await attesterRegistry.reputationOf(jurorC.address)).to.equal(95n); // 100 - 5
    });
  });

  describe("tie-break rule", function () {
    it("dismisses the dispute on a tie, favoring the attester, forfeiting the bond to them", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await disputeResolution.connect(jurorA).commitVote(0, commitFor(true, SALT_A, jurorA.address));
      await disputeResolution.connect(jurorB).commitVote(0, commitFor(false, SALT_B, jurorB.address));

      await time.increase(3600 + 1);
      await disputeResolution.connect(jurorA).revealVote(0, true, SALT_A);
      await disputeResolution.connect(jurorB).revealVote(0, false, SALT_B);
      await time.increase(3600 + 1);

      const employerBalanceBefore = await ethers.provider.getBalance(employer.address);

      await expect(disputeResolution.resolveDispute(0))
        .to.emit(disputeResolution, "DisputeResolved")
        .withArgs(0, 1 /* Dismissed */, 1, 1);

      const attestation = await attestationRegistry.getAttestation(attestationId);
      expect(attestation.status).to.equal(0); // Active again

      const employerBalanceAfter = await ethers.provider.getBalance(employer.address);
      expect(employerBalanceAfter - employerBalanceBefore).to.equal(DISPUTE_BOND);

      // No reputation reward on a tie (only a clean AttesterWon rewards reputation).
      expect(await attesterRegistry.reputationOf(employer.address)).to.equal(100n);
    });

    it("dismisses with no reward/penalty when no jurors participate at all", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await time.increase(3600 + 1);
      await time.increase(3600 + 1);

      await expect(disputeResolution.resolveDispute(0))
        .to.emit(disputeResolution, "DisputeResolved")
        .withArgs(0, 1 /* Dismissed */, 0, 0);
    });
  });

  describe("access control on commit/reveal", function () {
    it("rejects a non-attester acting as juror", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await expect(
        disputeResolution.connect(outsider).commitVote(0, commitFor(true, SALT_A, outsider.address))
      ).to.be.revertedWith("DisputeResolution: juror must be a registered attester");
    });

    it("rejects the attester or disputer serving as their own juror", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await expect(
        disputeResolution.connect(employer).commitVote(0, commitFor(true, SALT_A, employer.address))
      ).to.be.revertedWith("DisputeResolution: party cannot serve as juror");
    });

    it("rejects a reveal that doesn't match the commitment", async function () {
      const attestationId = await issueSampleAttestation();
      await disputeResolution.connect(employee).raiseDispute(attestationId, { value: DISPUTE_BOND });

      await disputeResolution.connect(jurorA).commitVote(0, commitFor(true, SALT_A, jurorA.address));
      await time.increase(3600 + 1);

      await expect(
        disputeResolution.connect(jurorA).revealVote(0, false, SALT_A) // wrong vote for the commit
      ).to.be.revertedWith("DisputeResolution: reveal does not match commitment");
    });
  });
});
