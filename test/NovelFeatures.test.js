const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  buildCredentialTree,
  buildDisclosure,
  signVerifiablePresentation,
  verifyPresentationSignature,
} = require("../lib/merkleCredential");

describe("Novel Features & Production Architecture", function () {
  let attesterRegistry, attestationRegistry, owner, employer, employee, verifierA, verifierB, attacker;
  const MIN_STAKE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, employer, employee, verifierA, verifierB, attacker] = await ethers.getSigners();

    const AttesterRegistry = await ethers.getContractFactory("AttesterRegistry");
    attesterRegistry = await AttesterRegistry.deploy();
    await attesterRegistry.waitForDeployment();

    const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
    attestationRegistry = await AttestationRegistry.deploy(await attesterRegistry.getAddress());
    await attestationRegistry.waitForDeployment();

    await attesterRegistry.connect(employer).registerAttester({ value: MIN_STAKE });
  });

  describe("Lifecycle Management: Expiry, Voluntary Revocation & Indexing", function () {
    it("enforces expiration date correctly", async function () {
      const { root } = buildCredentialTree({ role: "Lead Engineer" });
      const signature = await employer.signMessage(ethers.getBytes(root));

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const validUntil = now + 1000; // expires in 1000s

      const tx = await attestationRegistry
        .connect(employer)
        .issueAttestationWithLifecycle(employee.address, root, signature, validUntil, "");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((l) => {
          try {
            return attestationRegistry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e?.name === "AttestationIssued");
      const attestationId = event.args.attestationId;

      // Currently valid
      expect(await attestationRegistry.isAttestationValid(attestationId)).to.equal(true);

      // Fast-forward past expiry
      await ethers.provider.send("evm_increaseTime", [1500]);
      await ethers.provider.send("evm_mine");

      // Now expired
      expect(await attestationRegistry.isAttestationValid(attestationId)).to.equal(false);
    });

    it("allows the employer to voluntarily revoke an attestation with a reason", async function () {
      const { root } = buildCredentialTree({ role: "Junior Developer" });
      const signature = await employer.signMessage(ethers.getBytes(root));

      const tx = await attestationRegistry
        .connect(employer)
        .issueAttestation(employee.address, root, signature);
      const receipt = await tx.wait();
      const attestationId = receipt.logs
        .map((l) => {
          try {
            return attestationRegistry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e?.name === "AttestationIssued").args.attestationId;

      expect(await attestationRegistry.isAttestationValid(attestationId)).to.equal(true);

      // Attacker attempts to revoke -> rejected
      await expect(
        attestationRegistry.connect(attacker).revokeAttestation(attestationId, "I want to revoke this")
      ).to.be.revertedWith("AttestationRegistry: only issuing attester can revoke");

      // Employer revokes with reason
      await expect(
        attestationRegistry
          .connect(employer)
          .revokeAttestation(attestationId, "Terminated for policy breach")
      )
        .to.emit(attestationRegistry, "AttestationRevokedByAttester")
        .withArgs(attestationId, employer.address, "Terminated for policy breach");

      const att = await attestationRegistry.getAttestation(attestationId);
      expect(att.revokedByAttester).to.equal(true);
      expect(att.revocationReason).to.equal("Terminated for policy breach");
      expect(att.status).to.equal(2); // Status.Revoked
      expect(await attestationRegistry.isAttestationValid(attestationId)).to.equal(false);
    });

    it("indexes attestations by subject and attester and emits CredentialVaulted", async function () {
      const { root } = buildCredentialTree({ role: "Security Engineer" });
      const signature = await employer.signMessage(ethers.getBytes(root));

      const encryptedPayload = "AES256:ENCRYPTED_VAULT_BLOB_FOR_EMPLOYEE";
      const tx = await attestationRegistry
        .connect(employer)
        .issueAttestationWithLifecycle(employee.address, root, signature, 0, encryptedPayload);

      await expect(tx)
        .to.emit(attestationRegistry, "CredentialVaulted")
        .withArgs(0, employee.address, employer.address, encryptedPayload);

      const subjectAttestations = await attestationRegistry.getSubjectAttestations(employee.address);
      expect(subjectAttestations.length).to.equal(1);
      expect(subjectAttestations[0]).to.equal(0);

      const employerAttestations = await attestationRegistry.getAttesterAttestations(employer.address);
      expect(employerAttestations.length).to.equal(1);
      expect(employerAttestations[0]).to.equal(0);
    });
  });

  describe("Zero-Knowledge Range & Threshold Predicates", function () {
    it("derives and cryptographically verifies rating and tenure threshold predicates", async function () {
      const credential = {
        employer: "Google DeepMind",
        role: "Research Scientist",
        startDate: "2021-01-01",
        endDate: "2023-07-01", // 30 months
        performanceRating: "4.8", // >= 4.0, >= 4.5
      };

      const { tree, root, fields } = buildCredentialTree(credential, { includePredicates: true });
      const signature = await employer.signMessage(ethers.getBytes(root));

      await attestationRegistry.connect(employer).issueAttestation(employee.address, root, signature);

      // Employee selectively discloses ONLY threshold predicates (NOT the exact rating 4.8 or exact dates)
      const disclosed = buildDisclosure(tree, fields, [
        "role",
        "predicate:rating_gte_4.0",
        "predicate:rating_gte_4.5",
        "predicate:tenure_months_gte_24",
      ]);

      for (const d of disclosed) {
        const valid = await attestationRegistry.verifyDisclosure(0, d.leaf, d.proof);
        expect(valid, `Field ${d.fieldName} must verify on-chain`).to.equal(true);
        if (d.fieldName.startsWith("predicate:")) {
          expect(d.fieldValue).to.equal("true");
        }
      }

      // Tamper attempt: trying to prove a false claim (e.g. rating >= 4.8 when altered to bogus salt or value)
      const forgedField = {
        fieldName: "predicate:rating_gte_4.8",
        fieldValue: "true",
        salt: ethers.hexlify(ethers.randomBytes(32)),
      };
      const forgedLeaf = ethers.solidityPackedKeccak256(
        ["string", "string", "bytes32"],
        [forgedField.fieldName, forgedField.fieldValue, forgedField.salt]
      );
      // Using an arbitrary valid proof with a forged leaf will fail
      const bogusValid = await attestationRegistry.verifyDisclosure(0, forgedLeaf, disclosed[0].proof);
      expect(bogusValid).to.equal(false);
    });
  });

  describe("EIP-712 Verifiable Presentation (VP) Challenge-Response", function () {
    it("proves subject identity possession and resists replay attacks", async function () {
      const credential = {
        employer: "Anthropic",
        role: "Member of Technical Staff",
        performanceRating: "4.9",
      };

      const { tree, root, fields } = buildCredentialTree(credential);
      const signature = await employer.signMessage(ethers.getBytes(root));

      await attestationRegistry.connect(employer).issueAttestation(employee.address, root, signature);

      const disclosed = buildDisclosure(tree, fields, ["role", "predicate:rating_gte_4.5"]);

      // 1. Verifier A creates a session challenge
      const nonce = "verifier-session-challenge-98765";
      const presentation = await signVerifiablePresentation(employee, {
        verifier: verifierA.address,
        nonce,
        attestationId: 0,
        disclosed,
        chainId: 31337,
      });

      // 2. Verifier A verifies presentation
      const resultA = verifyPresentationSignature(presentation, employee.address, disclosed, {
        chainId: 31337,
      });
      expect(resultA.valid).to.equal(true);
      expect(resultA.recoveredSigner.toLowerCase()).to.equal(employee.address.toLowerCase());

      // 3. Replay attack: Mallory (attacker) intercepts Alice's disclosure and presentation and tries to send it to Verifier B
      // Verifier B checks against Verifier B's own address -> presentation.verifier mismatch
      const replayPresentation = { ...presentation, verifier: verifierB.address };
      // Recomputed signature won't match Verifier B's address
      const replayResult = verifyPresentationSignature(replayPresentation, employee.address, disclosed, {
        chainId: 31337,
      });
      expect(replayResult.valid).to.equal(false);

      // 4. Impersonation attack: Attacker signs a presentation for Alice's credential
      const attackerPresentation = await signVerifiablePresentation(attacker, {
        verifier: verifierA.address,
        nonce,
        attestationId: 0,
        disclosed,
        chainId: 31337,
      });
      const impersonationResult = verifyPresentationSignature(attackerPresentation, employee.address, disclosed, {
        chainId: 31337,
      });
      expect(impersonationResult.valid).to.equal(false);
      expect(impersonationResult.reason).to.include("does not match credential subject");
    });
  });
});
