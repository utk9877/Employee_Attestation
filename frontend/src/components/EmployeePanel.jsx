import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { rebuildTree, buildDisclosure, signVerifiablePresentation } from "../lib/merkleCredential";
import { saveCredential, getCredentials, saveLatestPresentation, getAllStoredCredentials } from "../lib/storage";
import { decryptVaultPayload, getDefaultVaultKey } from "../lib/cryptoVault";
import { deployedAddresses } from "../lib/contracts";
import CopyButton from "./CopyButton";

export default function EmployeePanel() {
  const { address, signer, contracts } = useWallet();
  const [importText, setImportText] = useState("");
  const [credentials, setCredentials] = useState([]);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedFields, setSelectedFields] = useState({}); // attestationId -> Set(fieldName)
  const [verifierAddress, setVerifierAddress] = useState("");
  const [presentationOutput, setPresentationOutput] = useState({}); // attestationId -> VP bundle
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [activeTab, setActiveTab] = useState("portfolio"); // "portfolio" | "import"

  useEffect(() => {
    if (address) {
      setCredentials(getCredentials(address));
      checkOnChainVault();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, contracts]);

  async function checkOnChainVault() {
    if (!contracts || !address) return;
    try {
      const filter = contracts.attestationRegistry.filters.CredentialVaulted(null, address);
      const events = await contracts.attestationRegistry.queryFilter(filter);
      const existing = getCredentials(address);
      const existingIds = new Set(existing.map((c) => String(c.attestationId)));

      const newEvents = events.filter((e) => !existingIds.has(e.args.attestationId.toString()));
      setDiscoveredCount(newEvents.length);
    } catch (err) {
      console.warn("Vault discovery query check:", err);
    }
  }

  async function handleAutoSync() {
    if (!contracts || !address) return;
    setBusy(true);
    setLog("Scanning blockchain for encrypted credentials issued to your wallet...");
    try {
      const filter = contracts.attestationRegistry.filters.CredentialVaulted(null, address);
      const events = await contracts.attestationRegistry.queryFilter(filter);
      const defaultKey = getDefaultVaultKey(address);

      let imported = 0;
      for (const e of events) {
        const attestationId = e.args.attestationId.toString();
        const encrypted = e.args.encryptedPayload;
        try {
          const decrypted = await decryptVaultPayload(encrypted, defaultKey);
          decrypted.attestationId = attestationId;
          saveCredential(address, decrypted);
          imported++;
        } catch (decryptErr) {
          console.warn(`Could not decrypt attestation #${attestationId}:`, decryptErr);
        }
      }

      setCredentials(getCredentials(address));
      setDiscoveredCount(0);
      setLog(`Sync complete. Imported and decrypted ${imported} credentials directly from the blockchain!`);
    } catch (err) {
      setLog("Auto-sync error: " + (err.shortMessage || err.message));
    } finally {
      setBusy(false);
    }
  }

  function handleManualImport() {
    try {
      const record = JSON.parse(importText);
      if (!record.attestationId || !record.root || !Array.isArray(record.fields)) {
        throw new Error("That doesn't look like a valid VeriRef credential blob.");
      }
      saveCredential(address, record);
      setCredentials(getCredentials(address));
      setImportText("");
      setActiveTab("portfolio");
      setLog(`Imported credential for attestation #${record.attestationId}.`);
    } catch (e) {
      setLog("Error: " + e.message);
    }
  }

  function toggleField(attestationId, fieldName) {
    setSelectedFields((prev) => {
      const current = new Set(prev[attestationId] || []);
      if (current.has(fieldName)) current.delete(fieldName);
      else current.add(fieldName);
      return { ...prev, [attestationId]: current };
    });
  }

  function selectAllFields(record) {
    const all = new Set(record.fields.map((f) => f.fieldName));
    setSelectedFields((prev) => ({ ...prev, [record.attestationId]: all }));
  }

  function selectOnlyPredicates(record) {
    const preds = new Set(
      record.fields
        .filter((f) => f.fieldName.startsWith("predicate:") || f.fieldName === "role" || f.fieldName === "employer")
        .map((f) => f.fieldName)
    );
    setSelectedFields((prev) => ({ ...prev, [record.attestationId]: preds }));
  }

  async function handleGenerateVP(record) {
    const chosen = Array.from(selectedFields[record.attestationId] || []);
    if (chosen.length === 0) {
      setLog("Select at least one field or threshold predicate to disclose.");
      return;
    }

    setBusy(true);
    setLog("Building selective Merkle proofs and generating EIP-712 Verifiable Presentation...");
    try {
      const tree = rebuildTree(record.fields);
      const disclosed = buildDisclosure(tree, record.fields, chosen);

      // Verifier challenge binding
      const targetVerifier = ethers.isAddress(verifierAddress)
        ? verifierAddress
        : ethers.ZeroAddress; // ZeroAddress indicates open / prospective presentation

      const nonce = "chal_" + Math.random().toString(36).substring(2, 12);
      const network = await signer.provider.getNetwork();
      const chainId = network.chainId.toString();

      setLog("Prompting subject signature to cryptographically bind presentation...");
      const presentation = await signVerifiablePresentation(signer, {
        verifier: targetVerifier,
        nonce,
        attestationId: record.attestationId,
        disclosed,
        chainId,
        verifyingContract: deployedAddresses.AttestationRegistry,
      });

      const vpBundle = {
        attestationId: record.attestationId,
        subject: record.subject || address,
        attester: record.attester,
        disclosed,
        presentation,
      };

      setPresentationOutput((prev) => ({ ...prev, [record.attestationId]: vpBundle }));
      saveLatestPresentation(vpBundle);
      setLog(`Verifiable Presentation generated for attestation #${record.attestationId}!`);
    } catch (e) {
      setLog("Error generating VP: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!address) return <p className="hint">Connect your MetaMask wallet to manage your credentials.</p>;

  const allStored = getAllStoredCredentials();

  return (
    <div className="panel">
      <h2>Employee (Credential Holder Portal)</h2>

      {/* On-Chain Auto-Discovery Notification */}
      {discoveredCount > 0 && (
        <div className="banner success-banner">
          <div>
            <strong>📬 On-Chain Credentials Detected!</strong>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Found {discoveredCount} encrypted credential(s) anchored to your address on the blockchain.
            </p>
          </div>
          <button disabled={busy} onClick={handleAutoSync} className="accent-btn">
            Auto-Sync &amp; Decrypt
          </button>
        </div>
      )}

      {/* Navigation Subtabs */}
      <div className="subtabs">
        <button
          className={activeTab === "portfolio" ? "subtab active" : "subtab"}
          onClick={() => setActiveTab("portfolio")}
        >
          My Credentials ({credentials.length})
        </button>
        <button
          className={activeTab === "import" ? "subtab active" : "subtab"}
          onClick={() => setActiveTab("import")}
        >
          + Manual JSON Import
        </button>
        <button className="subtab-action link" disabled={busy} onClick={handleAutoSync}>
          🔄 Refresh On-Chain Vault
        </button>
      </div>

      {activeTab === "import" && (
        <section className="card">
          <h3>Manual Credential Import</h3>
          <p className="hint">
            If an attestation was not auto-vaulted, paste the raw JSON blob received from your employer:
          </p>
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='Paste JSON credential blob here ({"attestationId": 0, "root": "0x...", "fields": [...]})'
          />
          <button onClick={handleManualImport} disabled={!importText.trim()}>
            Import Credential
          </button>
        </section>
      )}

      {activeTab === "portfolio" && credentials.length === 0 && (
        <section className="card empty-state">
          <p>
            No credentials found for currently connected account: <code>{address}</code>.
          </p>
          <p className="hint">
            Tip: If you switched accounts in MetaMask (e.g. to a Juror or Verifier account), switch back to the Employee account to view its credentials.
          </p>
          {allStored.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <p className="hint">
                Found {allStored.length} credential(s) previously saved on this browser from other accounts:
              </p>
              <button
                className="link font-highlight"
                style={{ fontSize: "0.95rem" }}
                onClick={() => setCredentials(allStored)}
              >
                📂 Load All {allStored.length} Local Browser Credential(s)
              </button>
            </div>
          )}
        </section>
      )}

      {activeTab === "portfolio" &&
        credentials.map((record) => {
          const rawFields = record.fields.filter((f) => !f.fieldName.startsWith("predicate:"));
          const predicateFields = record.fields.filter((f) => f.fieldName.startsWith("predicate:"));
          const vpBundle = presentationOutput[record.attestationId];

          return (
            <section className="card credential-card" key={record.attestationId}>
              <div className="card-header">
                <div>
                  <h3>Attestation #{record.attestationId}</h3>
                  <span className="hint">
                    Employer: <code>{record.attester?.slice(0, 8)}...{record.attester?.slice(-6)}</code>
                  </span>
                </div>
                <div className="quick-actions">
                  <button className="link btn-sm" onClick={() => selectAllFields(record)}>
                    Select All
                  </button>
                  {predicateFields.length > 0 && (
                    <button className="link btn-sm font-highlight" onClick={() => selectOnlyPredicates(record)}>
                      🛡️ Privacy Preset (Predicates Only)
                    </button>
                  )}
                </div>
              </div>

              {/* Standard Attributes */}
              <h4 className="section-subtitle">Direct Attributes</h4>
              <table className="field-table">
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}>Disclose</th>
                    <th>Attribute</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rawFields.map((f) => (
                    <tr key={f.fieldName}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedFields[record.attestationId]?.has(f.fieldName) || false}
                          onChange={() => toggleField(record.attestationId, f.fieldName)}
                        />
                      </td>
                      <td><strong>{f.fieldName}</strong></td>
                      <td>{f.fieldValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Zero-Knowledge Predicates */}
              {predicateFields.length > 0 && (
                <>
                  <h4 className="section-subtitle" style={{ marginTop: "1rem" }}>
                    🛡️ Zero-Knowledge Threshold Predicates
                    <span className="badge badge-info" style={{ marginLeft: "8px" }}>Privacy-Preserving</span>
                  </h4>
                  <p className="hint small">
                    Prove rating or tenure milestones cryptographically without revealing your exact numerical score or exact dates.
                  </p>
                  <table className="field-table">
                    <thead>
                      <tr>
                        <th style={{ width: "40px" }}>Disclose</th>
                        <th>Predicate Claim</th>
                        <th>Certified Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {predicateFields.map((f) => {
                        const cleanLabel = f.fieldName
                          .replace("predicate:rating_gte_", "Performance Rating ≥ ")
                          .replace("predicate:tenure_months_gte_", "Tenure ≥ ") +
                          (f.fieldName.includes("tenure") ? " Months" : " / 5.0");

                        return (
                          <tr key={f.fieldName}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedFields[record.attestationId]?.has(f.fieldName) || false}
                                onChange={() => toggleField(record.attestationId, f.fieldName)}
                              />
                            </td>
                            <td>
                              <span className="predicate-tag">{cleanLabel}</span>
                            </td>
                            <td>
                              <span className={`badge ${f.fieldValue === "true" ? "badge-success" : "badge-warn"}`}>
                                {f.fieldValue === "true" ? "Verified Met" : "Not Met"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {/* Verifiable Presentation Generator Form */}
              <div className="vp-generator-box" style={{ marginTop: "1.2rem" }}>
                <h4>Generate EIP-712 Verifiable Presentation (Anti-Replay)</h4>
                <p className="hint">
                  Optionally bind this disclosure to a specific verifier's address so nobody else can steal or replay your proof bundle.
                </p>
                <div className="form-row">
                  <input
                    value={verifierAddress}
                    onChange={(e) => setVerifierAddress(e.target.value)}
                    placeholder="Verifier Address (e.g. 0x... or leave blank for open presentation)"
                  />
                  <button disabled={busy} onClick={() => handleGenerateVP(record)}>
                    Sign &amp; Generate Presentation
                  </button>
                </div>
              </div>

              {/* VP Output & Shareable Presentation */}
              {vpBundle && (
                <div className="presentation-result-box">
                  <div className="card-header">
                    <h4>✅ Verifiable Presentation Package Ready</h4>
                    <span className="badge badge-success">Signed &amp; Anti-Replay Protected</span>
                  </div>
                  <p className="hint">
                    Share this verified proof bundle with recruiters or verifiers. They can verify each field against the on-chain Merkle root and confirm your wallet signature.
                  </p>
                  <textarea
                    readOnly
                    rows={8}
                    value={JSON.stringify(vpBundle, null, 2)}
                  />
                  <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                    <CopyButton value={JSON.stringify(vpBundle, null, 2)} />
                    <button
                      className="link"
                      onClick={() => {
                        const encoded = encodeURIComponent(JSON.stringify(vpBundle));
                        navigator.clipboard.writeText(
                          `${window.location.origin}${window.location.pathname}?vp=${encoded}`
                        );
                        alert("Direct verification URL copied to clipboard!");
                      }}
                    >
                      🔗 Copy Direct Verifier Link
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}

      {log && <p className="log">{log}</p>}
    </div>
  );
}
