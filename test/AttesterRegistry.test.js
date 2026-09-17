const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AttesterRegistry", function () {
  let registry, owner, alice, bob, slasherEOA;
  const MIN_STAKE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, alice, bob, slasherEOA] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("AttesterRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  describe("registration", function () {
    it("registers an attester who stakes at least the minimum", async function () {
      await expect(registry.connect(alice).registerAttester({ value: MIN_STAKE }))
        .to.emit(registry, "AttesterRegistered")
        .withArgs(alice.address, MIN_STAKE);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.stakeOf(alice.address)).to.equal(MIN_STAKE);
      expect(await registry.reputationOf(alice.address)).to.equal(100);
    });

    it("rejects registration below the minimum stake", async function () {
      const tooLittle = ethers.parseEther("0.001");
      await expect(
        registry.connect(alice).registerAttester({ value: tooLittle })
      ).to.be.revertedWith("AttesterRegistry: stake below minimum");
    });

    it("rejects double registration", async function () {
      await registry.connect(alice).registerAttester({ value: MIN_STAKE });
      await expect(
        registry.connect(alice).registerAttester({ value: MIN_STAKE })
      ).to.be.revertedWith("AttesterRegistry: already registered");
    });
  });

  describe("stake management", function () {
    beforeEach(async function () {
      await registry.connect(alice).registerAttester({ value: MIN_STAKE * 2n });
    });

    it("allows adding stake", async function () {
      await registry.connect(alice).addStake({ value: MIN_STAKE });
      expect(await registry.stakeOf(alice.address)).to.equal(MIN_STAKE * 3n);
    });

    it("allows partial withdrawal that stays above the minimum", async function () {
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await registry.connect(alice).withdrawStake(MIN_STAKE);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      expect(await registry.stakeOf(alice.address)).to.equal(MIN_STAKE);
      expect(await registry.isRegistered(alice.address)).to.equal(true);

      const after = await ethers.provider.getBalance(alice.address);
      expect(after).to.equal(before + MIN_STAKE - gasCost);
    });

    it("rejects a partial withdrawal that would drop below the minimum", async function () {
      const dust = MIN_STAKE + 1n; // leaves 1 wei, below MIN_STAKE
      await expect(registry.connect(alice).withdrawStake(dust)).to.be.revertedWith(
        "AttesterRegistry: remaining stake below minimum, withdraw full stake instead"
      );
    });

    it("allows full withdrawal and deregisters the attester", async function () {
      await expect(registry.connect(alice).withdrawStake(MIN_STAKE * 2n))
        .to.emit(registry, "AttesterDeregistered")
        .withArgs(alice.address);

      expect(await registry.isRegistered(alice.address)).to.equal(false);
      expect(await registry.stakeOf(alice.address)).to.equal(0);
    });
  });

  describe("slashing authorization", function () {
    beforeEach(async function () {
      await registry.connect(alice).registerAttester({ value: MIN_STAKE * 5n });
    });

    it("rejects slash calls from anyone but the configured slasher", async function () {
      await expect(
        registry.connect(bob).slash(alice.address, MIN_STAKE)
      ).to.be.revertedWith("AttesterRegistry: caller is not the slasher");
    });

    it("only the owner can set the slasher", async function () {
      await expect(
        registry.connect(bob).setSlasher(slasherEOA.address)
      ).to.be.reverted; // Ownable custom error
    });

    it("lets the configured slasher reduce stake and reputation", async function () {
      await registry.connect(owner).setSlasher(slasherEOA.address);

      await expect(registry.connect(slasherEOA).slash(alice.address, MIN_STAKE))
        .to.emit(registry, "AttesterSlashed")
        .withArgs(alice.address, MIN_STAKE, MIN_STAKE * 4n);

      expect(await registry.stakeOf(alice.address)).to.equal(MIN_STAKE * 4n);

      await registry.connect(slasherEOA).adjustReputation(alice.address, -50);
      expect(await registry.reputationOf(alice.address)).to.equal(50);
    });

    it("deregisters the attester if slashing drops stake below the minimum", async function () {
      await registry.connect(owner).setSlasher(slasherEOA.address);
      await registry.connect(slasherEOA).slash(alice.address, MIN_STAKE * 5n);

      expect(await registry.isRegistered(alice.address)).to.equal(false);
      expect(await registry.stakeOf(alice.address)).to.equal(0);
    });
  });
});
