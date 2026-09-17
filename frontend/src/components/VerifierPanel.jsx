import { useState } from "react";
import { useWallet } from "../context/WalletContext";
import { getProvider, getContracts, ATTESTATION_STATUS } from "../lib/contracts";
import CopyButton from "./CopyButton";

export default function VerifierPanel() {
  const { contracts: connectedContracts } = useWallet();
  const [bundleText, setBundleText] = useState("");
  const [results, setResults] = useState(null);
  const [attestationInfo, setAttestationInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [verifiedOutput, setVerifiedOutput] = useState(null);

  function readOnlyContracts() {
    // Verification is a pure read — works even without a connected wallet.
    if (connectedContracts) return connectedContracts;
    return getContracts(getProvider());
  }

  async function handleVerify() {
    setBusy(true);
    setLog("");
    setResults(null);
    setAttestationInfo(null);
    setVerifiedOutput(null);
    try {
      const bundle = JSON.parse(bundleText);
      if (!bundle.attestationId || !Array.isArray(bundle.disclosed)) {
        throw new Error("That doesn't look like a VeriRef disclosure bundle.");
      }

      const { attestationRegistry, attesterRegistry } = readOnlyContracts();

      const attestation = await attestationRegistry.getAttestation(bundle.attestationId);
      const reputation = await attesterRegistry.reputationOf(attestation.attester);

      setAttestationInfo({
        attester: attestation.attester,
        subject: attestation.subject,
        status: ATTESTATION_STATUS[Number(attestation.status)],
        issuedAt: new Date(Number(attestation.issuedAt) * 1000).toLocaleString(),
        reputation: reputation.toString(),
      });

      const checked = [];
      for (const d of bundle.disclosed) {
        const valid = await attestationRegistry.verifyDisclosure(bundle.attestationId, d.leaf, d.proof);
        checked.push({ fieldName: d.fieldName, fieldValue: d.fieldValue, valid });
      }
      setResults(checked);
      setVerifiedOutput({ ...bundle, verification: checked });
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Verifier</h2>
      <p className="hint">
        Paste a disclosure bundle from a candidate. Each field is checked against the on-chain
        Merkle root — you see only what they chose to reveal, cryptographically guaranteed to be
        unmodified.
      </p>

      <section className="card">
        <textarea
          rows={8}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
          placeholder="Paste disclosure bundle here..."
        />
        <button disabled={busy} onClick={handleVerify}>
          Verify
        </button>
      </section>

      {attestationInfo && (
        <section className="card">
          <h3>Attestation Info</h3>
          <ul className="stat-list">
            <li>Attester: {attestationInfo.attester}</li>
            <li>Attester reputation: {attestationInfo.reputation}</li>
            <li>Subject: {attestationInfo.subject}</li>
            <li>Status: {attestationInfo.status}</li>
            <li>Issued: {attestationInfo.issuedAt}</li>
          </ul>
        </section>
      )}

      {results && (
        <section className="card">
          <h3>Disclosed Fields</h3>
          <table className="field-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.fieldName}>
                  <td>{r.fieldName}</td>
                  <td>{r.fieldValue}</td>
                  <td className={r.valid ? "ok" : "fail"}>{r.valid ? "✓ valid" : "✗ invalid"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <CopyButton value={JSON.stringify(verifiedOutput, null, 2)} />
        </section>
      )}

      {log && <p className="log">{log}</p>}
    </div>
  );
}
