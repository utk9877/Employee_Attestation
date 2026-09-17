import { ethers } from "ethers";
import addresses from "../config/addresses.json";
import AttesterRegistryArtifact from "../abis/AttesterRegistry.json";
import AttestationRegistryArtifact from "../abis/AttestationRegistry.json";
import DisputeResolutionArtifact from "../abis/DisputeResolution.json";

export function getProvider() {
  if (!window.ethereum) {
    throw new Error("No injected wallet found. Install MetaMask to use VeriRef.");
  }
  return new ethers.BrowserProvider(window.ethereum);
}

export async function getSigner() {
  const provider = getProvider();
  await provider.send("eth_requestAccounts", []);
  return provider.getSigner();
}

export function getContracts(signerOrProvider) {
  return {
    attesterRegistry: new ethers.Contract(
      addresses.AttesterRegistry,
      AttesterRegistryArtifact.abi,
      signerOrProvider
    ),
    attestationRegistry: new ethers.Contract(
      addresses.AttestationRegistry,
      AttestationRegistryArtifact.abi,
      signerOrProvider
    ),
    disputeResolution: new ethers.Contract(
      addresses.DisputeResolution,
      DisputeResolutionArtifact.abi,
      signerOrProvider
    ),
  };
}

export const deployedAddresses = addresses;

export const ATTESTATION_STATUS = ["Active", "Disputed", "Revoked"];
export const DISPUTE_OUTCOME = ["Pending", "Dismissed", "AttesterWon", "DisputerWon"];
