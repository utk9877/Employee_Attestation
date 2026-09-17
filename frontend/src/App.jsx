import { useState } from "react";
import { useWallet } from "./context/WalletContext";
import { deployedAddresses } from "./lib/contracts";
import AttesterPanel from "./components/AttesterPanel";
import EmployeePanel from "./components/EmployeePanel";
import VerifierPanel from "./components/VerifierPanel";
import DisputesPanel from "./components/DisputesPanel";
import "./App.css";

const TABS = [
  { id: "attester", label: "Attester", Component: AttesterPanel },
  { id: "employee", label: "Employee", Component: EmployeePanel },
  { id: "verifier", label: "Verifier", Component: VerifierPanel },
  { id: "disputes", label: "Disputes", Component: DisputesPanel },
];

function shorten(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

export default function App() {
  const [active, setActive] = useState("attester");
  const { address, connect, error, wrongNetwork } = useWallet();
  const ActiveComponent = TABS.find((t) => t.id === active).Component;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const addressesConfigured = deployedAddresses.AttesterRegistry !== ZERO_ADDRESS;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>VeriRef</h1>
          <p className="tagline">Decentralized Employment Attestation &amp; Verification Network</p>
        </div>
        <div>
          {address ? (
            <span className="pill">{shorten(address)}</span>
          ) : (
            <button onClick={connect}>Connect Wallet</button>
          )}
        </div>
      </header>

      {!addressesConfigured && (
        <div className="banner warn">
          No contract addresses configured. Run <code>npx hardhat node</code> then{" "}
          <code>npx hardhat run scripts/deploy.js --network localhost</code> from the project root,
          then refresh.
        </div>
      )}
      {wrongNetwork && (
        <div className="banner warn">
          Wallet is on a different network than the deployed contracts (expected chainId{" "}
          {deployedAddresses.chainId}). Switch MetaMask to the local Hardhat network.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === active ? "tab active" : "tab"}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        <ActiveComponent />
      </main>
    </div>
  );
}
