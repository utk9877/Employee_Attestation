import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { getProvider, getContracts } from "../lib/contracts";

export default function LeaderboardPanel() {
  const { contracts: connectedContracts } = useWallet();
  const [attesters, setAttesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function readOnlyContracts() {
    if (connectedContracts) return connectedContracts;
    return getContracts(getProvider());
  }

  async function loadLeaderboard() {
    setLoading(true);
    setError("");
    try {
      const { attesterRegistry, attestationRegistry } = readOnlyContracts();

      // Query AttesterRegistered events to discover all employers who have ever registered
      const filter = attesterRegistry.filters.AttesterRegistered();
      const events = await attesterRegistry.queryFilter(filter);

      const uniqueAddrs = Array.from(new Set(events.map((e) => e.args.attester)));

      const records = await Promise.all(
        uniqueAddrs.map(async (addr) => {
          const [registered, stake, reputation, attestationIds] = await Promise.all([
            attesterRegistry.isRegistered(addr),
            attesterRegistry.stakeOf(addr),
            attesterRegistry.reputationOf(addr),
            attestationRegistry.getAttesterAttestations(addr).catch(() => []),
          ]);

          return {
            address: addr,
            registered,
            stake: ethers.formatEther(stake),
            rawStake: stake,
            reputation: Number(reputation),
            attestationCount: attestationIds.length,
          };
        })
      );

      // Sort by reputation descending, then stake descending
      records.sort((a, b) => b.reputation - a.reputation || (b.rawStake > a.rawStake ? 1 : -1));

      setAttesters(records);
    } catch (err) {
      console.error("Leaderboard load failed:", err);
      setError("Failed to load attester directory: " + (err.shortMessage || err.message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLeaderboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedContracts]);

  function getTrustTier(reputation, registered) {
    if (!registered) return { label: "Deregistered / Slashed", class: "badge-danger" };
    if (reputation >= 120) return { label: "Elite Attester ⭐⭐⭐", class: "badge-success" };
    if (reputation >= 100) return { label: "Verified Attester ⭐⭐", class: "badge-info" };
    if (reputation >= 50) return { label: "Under Observation ⭐", class: "badge-warn" };
    return { label: "High Risk", class: "badge-danger" };
  }

  return (
    <div className="panel">
      <div className="card-header">
        <div>
          <h2>Attester Reputation Directory</h2>
          <p className="hint">
            Transparent on-chain accountability: view registered employers, staked collateral, and dynamic reputation scores.
          </p>
        </div>
        <button className="link" onClick={loadLeaderboard} disabled={loading}>
          {loading ? "Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className="card">
        {loading ? (
          <p className="hint">Scanning blockchain events for registered attesters...</p>
        ) : attesters.length === 0 ? (
          <p className="hint">No employers have registered on-chain yet.</p>
        ) : (
          <table className="field-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Employer Address</th>
                <th>Reputation Score</th>
                <th>Staked Collateral</th>
                <th>Issued Attestations</th>
                <th>Trust Tier</th>
              </tr>
            </thead>
            <tbody>
              {attesters.map((a, idx) => {
                const tier = getTrustTier(a.reputation, a.registered);
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;

                return (
                  <tr key={a.address}>
                    <td>
                      <strong style={{ fontSize: "1.1rem" }}>{medal}</strong>
                    </td>
                    <td>
                      <code>{a.address.slice(0, 8)}...{a.address.slice(-6)}</code>
                    </td>
                    <td>
                      <strong className="font-highlight">{a.reputation}</strong> pts
                    </td>
                    <td>{a.stake} ETH</td>
                    <td>{a.attestationCount}</td>
                    <td>
                      <span className={`badge ${tier.class}`}>{tier.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
