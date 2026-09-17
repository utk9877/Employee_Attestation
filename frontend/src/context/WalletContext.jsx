import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getProvider, getContracts, deployedAddresses } from "../lib/contracts";

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState(null);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const provider = getProvider();
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      const newSigner = await provider.getSigner();
      const addr = await newSigner.getAddress();

      setSigner(newSigner);
      setAddress(addr);
      setChainId(network.chainId.toString());
      setContracts(getContracts(newSigner));
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = () => connect();
    const onChainChanged = () => connect();
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [connect]);

  const wrongNetwork =
    address && deployedAddresses.chainId !== "0" && chainId !== deployedAddresses.chainId;

  return (
    <WalletContext.Provider
      value={{ address, chainId, signer, contracts, error, connect, wrongNetwork }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
