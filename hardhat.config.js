require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    // Port 8545 is often already taken by another project's local node, so this
    // project's local chain runs on 8546 instead (see README for the exact commands).
    localhost: {
      url: "http://127.0.0.1:8546",
    },
    // Uncomment and fill in for a Sepolia demo deploy (Stage 7):
    // sepolia: {
    //   url: process.env.SEPOLIA_RPC_URL || "",
    //   accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    // },
  },
};
