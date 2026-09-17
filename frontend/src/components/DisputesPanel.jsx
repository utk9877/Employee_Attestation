import { useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { DISPUTE_OUTCOME } from "../lib/contracts";
import { saveVoteSecret, getVoteSecret } from "../lib/storage";

function useDisputeLookup(contracts) {
  const [disputeId, setDisputeId] = useState("");
  const [dispute, setDispute] = useState(null);
  const [log, setLog] = useState("");

  async function refresh(id = disputeId) {
    if (id === "" || !contracts) return;
    try {
      const d = await contracts.disputeResolution.getDispute(id);
      setDispute(d);
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    }
  }

  return { disputeId, setDisputeId, dispute, refresh, log, setLog };
}

export default function DisputesPanel() {
  const { address, contracts } = useWallet();
  const [attestationId, setAttestationId] = useState("");
  const [bond, setBond] = useState(null);
  const [raiseLog, setRaiseLog] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = useDisputeLookup(contracts);
  const [vote, setVote] = useState("true");

  async function loadBond() {
    if (!contracts) return;
    const b = await contracts.disputeResolution.DISPUTE_BOND();
    setBond(b);
  }

  async function handleRaise() {
    setBusy(true);
    setRaiseLog("Raising dispute...");
    try {
      if (!bond) await loadBond();
      const b = bond || (await contracts.disputeResolution.DISPUTE_BOND());
      const tx = await contracts.disputeResolution.raiseDispute(attestationId, { value: b });
      const receipt = await tx.wait();
      let newId = null;
      for (const l of receipt.logs) {
        try {
          const parsed = contracts.disputeResolution.interface.parseLog(l);
          if (parsed?.name === "DisputeRaised") newId = parsed.args.disputeId.toString();
        } catch {
          /* ignore */
        }
      }
      setRaiseLog(`Dispute #${newId} raised. Use the panel below to track/vote on it.`);
      if (newId !== null) {
        lookup.setDisputeId(newId);
        lookup.refresh(newId);
      }
    } catch (e) {
      setRaiseLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true);
    lookup.setLog("Committing vote...");
    try {
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const voteBool = vote === "true";
      const commitHash = ethers.solidityPackedKeccak256(
        ["bool", "bytes32", "address"],
        [voteBool, salt, address]
      );
      const tx = await contracts.disputeResolution.commitVote(lookup.disputeId, commitHash);
      await tx.wait();
      saveVoteSecret(lookup.disputeId, address, { vote: voteBool, salt });
      lookup.setLog("Vote committed (kept secret locally until you reveal).");
      lookup.refresh();
    } catch (e) {
      lookup.setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    setBusy(true);
    lookup.setLog("Revealing vote...");
    try {
      const secret = getVoteSecret(lookup.disputeId, address);
      if (!secret) throw new Error("No locally-saved vote found for this dispute/address.");
      const tx = await contracts.disputeResolution.revealVote(lookup.disputeId, secret.vote, secret.salt);
      await tx.wait();
      lookup.setLog("Vote revealed.");
      lookup.refresh();
    } catch (e) {
      lookup.setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve() {
    setBusy(true);
    lookup.setLog("Resolving dispute...");
    try {
      const tx = await contracts.disputeResolution.resolveDispute(lookup.disputeId);
      await tx.wait();
      lookup.setLog("Dispute resolved.");
      lookup.refresh();
    } catch (e) {
      lookup.setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!address) return <p className="hint">Connect your wallet to raise disputes or serve as a juror.</p>;

  const now = Math.floor(Date.now() / 1000);
  const d = lookup.dispute;

  return (
    <div className="panel">
      <h2>Disputes</h2>

      <section className="card">
        <h3>Raise a Dispute</h3>
        <p className="hint">
          Anyone (typically the employee, or a third party) can dispute an Active attestation they
          believe is fraudulent. Requires a bond, refunded if the dispute succeeds.
        </p>
        <label>
          Attestation ID
          <input value={attestationId} onChange={(e) => setAttestationId(e.target.value)} />
        </label>
        <button disabled={busy || attestationId === ""} onClick={handleRaise}>
          Raise Dispute {bond ? `(bond: ${ethers.formatEther(bond)} ETH)` : ""}
        </button>
        {raiseLog && <p className="log">{raiseLog}</p>}
      </section>

      <section className="card">
        <h3>Track / Act on a Dispute</h3>
        <label>
          Dispute ID
          <input value={lookup.disputeId} onChange={(e) => lookup.setDisputeId(e.target.value)} />
        </label>
        <button disabled={busy} onClick={() => lookup.refresh()}>
          Load
        </button>

        {d && d.disputer !== ethers.ZeroAddress && (
          <div>
            <ul className="stat-list">
              <li>Attestation ID: {d.attestationId.toString()}</li>
              <li>Attester (defendant): {d.attester}</li>
              <li>Disputer: {d.disputer}</li>
              <li>Bond: {ethers.formatEther(d.bond)} ETH</li>
              <li>
                Commit phase {now > Number(d.commitDeadline) ? "closed" : "open"} (deadline{" "}
                {new Date(Number(d.commitDeadline) * 1000).toLocaleString()})
              </li>
              <li>
                Reveal phase{" "}
                {now <= Number(d.commitDeadline)
                  ? "not started"
                  : now > Number(d.revealDeadline)
                    ? "closed"
                    : "open"}{" "}
                (deadline {new Date(Number(d.revealDeadline) * 1000).toLocaleString()})
              </li>
              <li>Votes for attester: {d.votesForAttester.toString()}</li>
              <li>Votes for disputer (fraud): {d.votesForDisputer.toString()}</li>
              <li>Resolved: {d.resolved ? "Yes" : "No"}</li>
            </ul>

            <div className="dispute-actions">
              <div>
                <h4>Commit (as juror)</h4>
                <select value={vote} onChange={(e) => setVote(e.target.value)}>
                  <option value="true">Attestation is valid</option>
                  <option value="false">Attestation is fraudulent</option>
                </select>
                <button disabled={busy} onClick={handleCommit}>
                  Commit Vote
                </button>
              </div>
              <div>
                <h4>Reveal</h4>
                <button disabled={busy} onClick={handleReveal}>
                  Reveal My Vote
                </button>
              </div>
              <div>
                <h4>Resolve</h4>
                <button disabled={busy} onClick={handleResolve}>
                  Resolve Dispute
                </button>
              </div>
            </div>
          </div>
        )}

        {lookup.log && <p className="log">{lookup.log}</p>}
      </section>
    </div>
  );
}
