import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { buildCredentialTree } from "../lib/merkleCredential";
import { encryptVaultPayload, getDefaultVaultKey } from "../lib/cryptoVault";
import { ATTESTATION_STATUS } from "../lib/contracts";
import CopyButton from "./CopyButton";

const EMPTY_FIELD = { fieldName: "", fieldValue: "" };

export default function AttesterPanel() {
  const { address, signer, contracts } = useWallet();
  const [status, setStatus] = useState(null); // { registered, stake, reputation }
  const [minStake, setMinStake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const [subject, setSubject] = useState("");
  const [validityMonths, setValidityMonths] = useState("0"); // 0 = never expires
  const [includePredicates, setIncludePredicates] = useState(true);
  const [autoVault, setAutoVault] = useState(true);

  const [fields, setFields] = useState([
    { fieldName: "employer", fieldValue: "TechCorp Labs" },
    { fieldName: "role", fieldValue: "Senior Systems Architect" },
    { fieldName: "startDate", fieldValue: "2022-03-01" },
    { fieldName: "endDate", fieldValue: "2024-08-31" },
    { fieldName: "performanceRating", fieldValue: "4.8" },
  ]);
  const [issuedBlob, setIssuedBlob] = useState(null);
  const [myAttestations, setMyAttestations] = useState([]);
  const [revokingId, setRevokingId] = useState(null);
  const [revokeReason, setRevokeReason] = useState("Terminated for policy violation");

  async function refreshStatus() {
    if (!contracts || !address) return;
    try {
      const [registered, stake, reputation, min] = await Promise.all([
        contracts.attesterRegistry.isRegistered(address),
        contracts.attesterRegistry.stakeOf(address),
        contracts.attesterRegistry.reputationOf(address),
        contracts.attesterRegistry.MIN_STAKE(),
      ]);
      setStatus({ registered, stake, reputation });
      setMinStake(min);

      if (registered) {
        await loadMyAttestations();
      }
    } catch (err) {
      console.error("Status load error:", err);
    }
  }

  async function loadMyAttestations() {
    if (!contracts || !address) return;
    try {
      const ids = await contracts.attestationRegistry.getAttesterAttestations(address);
      const items = await Promise.all(
        ids.map(async (rawId) => {
          const id = rawId.toString();
          const att = await contracts.attestationRegistry.getAttestation(id);
          const isValid = await contracts.attestationRegistry.isAttestationValid(id);
          return {
            id,
            subject: att.subject,
            issuedAt: new Date(Number(att.issuedAt) * 1000).toLocaleDateString(),
            validUntil:
              Number(att.validUntil) > 0
                ? new Date(Number(att.validUntil) * 1000).toLocaleDateString()
                : "Never (Perpetual)",
            status: ATTESTATION_STATUS[Number(att.status)],
            revokedByAttester: att.revokedByAttester,
            revocationReason: att.revocationReason,
            isValid,
          };
        })
      );
      setMyAttestations(items.reverse());
    } catch (err) {
      console.error("Failed to load employer attestations:", err);
    }
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, address]);

  async function handleRegister() {
    setBusy(true);
    setLog("Registering as attester with stake collateral...");
    try {
      const tx = await contracts.attesterRegistry.registerAttester({ value: minStake });
      await tx.wait();
      setLog("Successfully registered as verified attester.");
      await refreshStatus();
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  function updateField(i, key, value) {
    const next = [...fields];
    next[i] = { ...next[i], [key]: value };
    setFields(next);
  }

  function addField() {
    setFields([...fields, { ...EMPTY_FIELD }]);
  }

  function removeField(i) {
    setFields(fields.filter((_, idx) => idx !== i));
  }

  async function handleIssue() {
    setBusy(true);
    setLog("Constructing Merkle credential tree and deriving predicate leaves...");
    setIssuedBlob(null);
    try {
      if (!ethers.isAddress(subject)) throw new Error("Enter a valid subject (employee) Ethereum address");

      const credential = {};
      for (const f of fields) {
        if (!f.fieldName) continue;
        credential[f.fieldName] = f.fieldValue;
      }
      if (Object.keys(credential).length === 0) throw new Error("Add at least one field");

      const { root, fields: builtFields } = buildCredentialTree(credential, {
        includePredicates,
      });
      setLog("Prompting employer signature over Merkle root (EIP-191)...");
      const signature = await signer.signMessage(ethers.getBytes(root));

      // Calculate expiration timestamp
      let validUntil = 0;
      const months = parseInt(validityMonths, 10);
      if (months > 0) {
        validUntil = Math.floor(Date.now() / 1000) + months * 30 * 24 * 60 * 60;
      }

      // Build payload blob
      const rawBlob = {
        subject,
        attester: address,
        root,
        fields: builtFields,
      };

      let encryptedPayload = "";
      if (autoVault) {
        setLog("Encrypting credential payload for automatic employee discovery...");
        const defaultKey = getDefaultVaultKey(subject);
        encryptedPayload = await encryptVaultPayload(rawBlob, defaultKey);
      }

      setLog("Anchoring attestation on-chain with lifecycle settings...");
      const tx = await contracts.attestationRegistry.issueAttestationWithLifecycle(
        subject,
        root,
        signature,
        validUntil,
        encryptedPayload
      );
      const receipt = await tx.wait();

      let attestationId = null;
      for (const l of receipt.logs) {
        try {
          const parsed = contracts.attestationRegistry.interface.parseLog(l);
          if (parsed?.name === "AttestationIssued") {
            attestationId = parsed.args.attestationId.toString();
          }
        } catch {
          /* ignore non-matching logs */
        }
      }

      const completeBlob = {
        attestationId,
        ...rawBlob,
      };
      setIssuedBlob(completeBlob);
      setLog(
        `Attestation #${attestationId} successfully issued! ${
          autoVault
            ? "Payload safely vaulted on-chain for zero-copy auto-discovery by employee."
            : "Share the credential JSON below with the employee."
        }`
      );

      await loadMyAttestations();
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id) {
    if (!revokeReason.trim()) {
      alert("Please provide a reason for revocation");
      return;
    }
    setBusy(true);
    setLog(`Revoking attestation #${id}...`);
    try {
      const tx = await contracts.attestationRegistry.revokeAttestation(id, revokeReason);
      await tx.wait();
      setLog(`Attestation #${id} revoked.`);
      setRevokingId(null);
      await loadMyAttestations();
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!address) return <p className="hint">Connect your wallet to act as an attester (employer).</p>;

  return (
    <div className="panel">
      <h2>Attester (Employer Portal)</h2>

      {/* Account & Stake Status */}
      <section className="card">
        <h3>Employer Trust Profile</h3>
        {status && (
          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-label">Status</span>
              <span className={`badge ${status.registered ? "badge-success" : "badge-warn"}`}>
                {status.registered ? "Active & Staked" : "Not Registered"}
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Staked Collateral</span>
              <span className="stat-value">
                {status.stake !== undefined ? ethers.formatEther(status.stake) : "-"} ETH
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Reputation Score</span>
              <span className="stat-value font-highlight">
                ⭐ {status.reputation?.toString?.() ?? "-"}
              </span>
            </div>
          </div>
        )}
        {status && !status.registered && (
          <div style={{ marginTop: "1rem" }}>
            <p className="hint">
              Employers must stake minimum collateral to issue accountable attestations.
            </p>
            <button disabled={busy || !minStake} onClick={handleRegister}>
              Register with Stake ({minStake ? ethers.formatEther(minStake) : "..."} ETH)
            </button>
          </div>
        )}
      </section>

      {/* Issuance Form */}
      <section className="card">
        <h3>Issue New Employment Attestation</h3>
        <label>
          Employee (Subject) Ethereum Address
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="0x... (Recipient wallet address)"
          />
        </label>

        <div className="form-row">
          <label style={{ flex: 1 }}>
            Validity Duration
            <select value={validityMonths} onChange={(e) => setValidityMonths(e.target.value)}>
              <option value="0">Perpetual (No Expiry)</option>
              <option value="6">6 Months</option>
              <option value="12">1 Year</option>
              <option value="24">2 Years</option>
              <option value="36">3 Years</option>
            </select>
          </label>
        </div>

        <div className="feature-toggles">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includePredicates}
              onChange={(e) => setIncludePredicates(e.target.checked)}
            />
            <span>
              <strong>Generate Zero-Knowledge Range Predicates</strong>
              <small className="hint d-block">
                Auto-derives threshold claims (e.g., Rating ≥ 4.0, Tenure ≥ 24m) so employees can prove milestones without exposing raw scores.
              </small>
            </span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoVault}
              onChange={(e) => setAutoVault(e.target.checked)}
            />
            <span>
              <strong>On-Chain Encrypted Vault (Zero Copy-Paste)</strong>
              <small className="hint d-block">
                Encrypts payload for employee's wallet so it automatically appears in their inbox.
              </small>
            </span>
          </label>
        </div>

        <h4 style={{ marginTop: "1.2rem", marginBottom: "0.5rem" }}>Credential Attributes</h4>
        <table className="field-table">
          <thead>
            <tr>
              <th>Attribute Name</th>
              <th>Certified Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={f.fieldName}
                    onChange={(e) => updateField(i, "fieldName", e.target.value)}
                    placeholder="e.g. role, department, salaryBand"
                  />
                </td>
                <td>
                  <input
                    value={f.fieldValue}
                    onChange={(e) => updateField(i, "fieldValue", e.target.value)}
                    placeholder="e.g. Staff Engineer, 4.8, L6"
                  />
                </td>
                <td>
                  <button className="link danger" onClick={() => removeField(i)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link" onClick={addField}>
          + Add Custom Attribute
        </button>

        <div style={{ marginTop: "1.5rem" }}>
          <button disabled={busy || !status?.registered} onClick={handleIssue}>
            Sign &amp; Anchor Attestation
          </button>
          {status && !status.registered && (
            <p className="hint warn-text">You must register as an attester first.</p>
          )}
        </div>

        {issuedBlob && (
          <div className="output-box" style={{ marginTop: "1.5rem" }}>
            <h4>Issued Credential Package</h4>
            <p className="hint">
              {autoVault
                ? "✅ Credential has been securely encrypted and vaulted on-chain. The employee will auto-discover it when connecting their wallet."
                : "Manual Backup: You can share this JSON blob with the employee if preferred."}
            </p>
            <textarea readOnly rows={6} value={JSON.stringify(issuedBlob, null, 2)} />
            <CopyButton value={JSON.stringify(issuedBlob, null, 2)} />
          </div>
        )}
      </section>

      {/* Issued Attestation Management & Voluntary Revocation */}
      <section className="card">
        <h3>Managed Attestations ({myAttestations.length})</h3>
        {myAttestations.length === 0 ? (
          <p className="hint">No attestations issued from this account yet.</p>
        ) : (
          <table className="field-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {myAttestations.map((att) => (
                <tr key={att.id}>
                  <td><strong>#{att.id}</strong></td>
                  <td title={att.subject}>
                    <code>{att.subject.slice(0, 6)}...{att.subject.slice(-4)}</code>
                  </td>
                  <td>{att.issuedAt}</td>
                  <td>{att.validUntil}</td>
                  <td>
                    <span
                      className={`badge ${
                        att.isValid
                          ? "badge-success"
                          : att.revokedByAttester
                          ? "badge-danger"
                          : "badge-warn"
                      }`}
                    >
                      {att.revokedByAttester
                        ? "Revoked by Employer"
                        : !att.isValid
                        ? "Expired"
                        : att.status}
                    </span>
                    {att.revokedByAttester && att.revocationReason && (
                      <div className="hint small">Reason: {att.revocationReason}</div>
                    )}
                  </td>
                  <td>
                    {att.status === "Active" && !att.revokedByAttester && (
                      <div>
                        {revokingId === att.id ? (
                          <div className="inline-revoke-box">
                            <input
                              value={revokeReason}
                              onChange={(e) => setRevokeReason(e.target.value)}
                              placeholder="Revocation reason..."
                            />
                            <button
                              className="danger-btn btn-sm"
                              disabled={busy}
                              onClick={() => handleRevoke(att.id)}
                            >
                              Confirm Revoke
                            </button>
                            <button
                              className="link btn-sm"
                              onClick={() => setRevokingId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="link danger"
                            onClick={() => {
                              setRevokingId(att.id);
                              setRevokeReason("Contract terminated / credential superseded");
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {log && <p className="log">{log}</p>}
    </div>
  );
}
