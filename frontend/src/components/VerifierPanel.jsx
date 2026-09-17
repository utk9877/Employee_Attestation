import { useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { getProvider, getContracts, ATTESTATION_STATUS, deployedAddresses } from "../lib/contracts";
import { verifyPresentationSignature } from "../lib/merkleCredential";
import CopyButton from "./CopyButton";

export default function VerifierPanel() {
  const { address: connectedAddress, contracts: connectedContracts } = useWallet();
  const [bundleText, setBundleText] = useState("");
  const [results, setResults] = useState(null);
  const [attestationInfo, setAttestationInfo] = useState(null);
  const [vpCheck, setVpCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  // Check URL parameters for direct verification link (?vp=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vpParam = params.get("vp");
    if (vpParam) {
      try {
        const decoded = decodeURIComponent(vpParam);
        setBundleText(decoded);
        setTimeout(() => {
          handleVerifyText(decoded);
        }, 300);
      } catch (err) {
        console.warn("Could not decode URL VP parameter:", err);
      }
    }
  }, []);

  function readOnlyContracts() {
    if (connectedContracts) return connectedContracts;
    return getContracts(getProvider());
  }

  async function handleVerify() {
    await handleVerifyText(bundleText);
  }

  async function handleVerifyText(textToVerify) {
    setBusy(true);
    setLog("");
    setResults(null);
    setAttestationInfo(null);
    setVpCheck(null);

    try {
      if (!textToVerify.trim()) throw new Error("Please paste a disclosure or presentation bundle.");
      const bundle = JSON.parse(textToVerify);
      if (bundle.attestationId === undefined || !Array.isArray(bundle.disclosed)) {
        throw new Error("That doesn't look like a valid VeriRef disclosure or presentation bundle.");
      }

      const { attestationRegistry, attesterRegistry } = readOnlyContracts();

      // 1. Fetch on-chain attestation record and attester reputation
      const attestation = await attestationRegistry.getAttestation(bundle.attestationId);
      if (attestation.attester === "0x0000000000000000000000000000000000000000") {
        throw new Error(`Attestation #${bundle.attestationId} does not exist on-chain.`);
      }

      const reputation = await attesterRegistry.reputationOf(attestation.attester);
      const attesterStake = await attesterRegistry.stakeOf(attestation.attester);
      const isValidOnChain = await attestationRegistry.isAttestationValid(bundle.attestationId);

      const issuedAtDate = new Date(Number(attestation.issuedAt) * 1000).toLocaleString();
      const expiresAtDate =
        Number(attestation.validUntil) > 0
          ? new Date(Number(attestation.validUntil) * 1000).toLocaleString()
          : "Never (Perpetual)";

      const isExpired =
        Number(attestation.validUntil) > 0 &&
        Date.now() / 1000 > Number(attestation.validUntil);

      setAttestationInfo({
        id: bundle.attestationId,
        attester: attestation.attester,
        attesterStake: ethers.formatEther(attesterStake),
        subject: attestation.subject,
        status: ATTESTATION_STATUS[Number(attestation.status)],
        isValidOnChain,
        issuedAt: issuedAtDate,
        expiresAt: expiresAtDate,
        isExpired,
        revokedByAttester: attestation.revokedByAttester,
        revocationReason: attestation.revocationReason,
        reputation: reputation.toString(),
      });

      // 2. Cryptographic Verification: Merkle Proofs against on-chain root
      const checked = [];
      for (const d of bundle.disclosed) {
        const valid = await attestationRegistry.verifyDisclosure(
          bundle.attestationId,
          d.leaf,
          d.proof
        );
        checked.push({
          fieldName: d.fieldName,
          fieldValue: d.fieldValue,
          isPredicate: d.fieldName.startsWith("predicate:"),
          valid,
        });
      }
      setResults(checked);

      // 3. Verifiable Presentation (VP) Identity Check (Proof-of-Possession & Anti-Replay)
      if (bundle.presentation) {
        const vpResult = verifyPresentationSignature(
          bundle.presentation,
          attestation.subject,
          bundle.disclosed,
          {
            chainId: deployedAddresses.chainId || 31337,
            verifyingContract: deployedAddresses.AttestationRegistry,
          }
        );

        const isVerifierTargetMatched =
          bundle.presentation.verifier === ethers.ZeroAddress ||
          (connectedAddress &&
            bundle.presentation.verifier.toLowerCase() === connectedAddress.toLowerCase());

        setVpCheck({
          hasPresentation: true,
          valid: vpResult.valid,
          signer: vpResult.recoveredSigner,
          expectedSubject: attestation.subject,
          verifierTarget: bundle.presentation.verifier,
          isVerifierTargetMatched,
          timestamp: new Date(Number(bundle.presentation.timestamp) * 1000).toLocaleString(),
          reason: vpResult.reason,
        });
      } else {
        setVpCheck({
          hasPresentation: false,
        });
      }
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Verifier (Recruiter &amp; Organization Portal)</h2>
      <p className="hint">
        Verify selective disclosures and candidate presentations against anchored blockchain Merkle roots.
        Confirms authenticity, checks employer collateral, and validates candidate identity.
      </p>

      <section className="card">
        <h3>Input Credential or Verifiable Presentation</h3>
        <textarea
          rows={6}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
          placeholder='Paste presentation bundle JSON here...'
        />
        <div style={{ display: "flex", gap: "10px" }}>
          <button disabled={busy} onClick={handleVerify}>
            {busy ? "Verifying On-Chain..." : "Verify Attestation"}
          </button>
          {bundleText && (
            <button className="link" onClick={() => setBundleText("")}>
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Attestation & Employer Integrity Header */}
      {attestationInfo && (
        <section className="card">
          <div className="card-header">
            <h3>Attestation #{attestationInfo.id} Integrity Report</h3>
            <span
              className={`badge ${
                attestationInfo.isValidOnChain
                  ? "badge-success"
                  : attestationInfo.revokedByAttester
                  ? "badge-danger"
                  : "badge-warn"
              }`}
            >
              {attestationInfo.revokedByAttester
                ? "Revoked by Employer"
                : attestationInfo.isExpired
                ? "Expired"
                : attestationInfo.status}
            </span>
          </div>

          {attestationInfo.revokedByAttester && (
            <div className="banner error" style={{ margin: "10px 0" }}>
              <strong>⚠️ Employer Revocation Notice:</strong> This attestation was officially revoked by the issuing employer.
              {attestationInfo.revocationReason && (
                <div>Reason: <em>"{attestationInfo.revocationReason}"</em></div>
              )}
            </div>
          )}

          {attestationInfo.isExpired && (
            <div className="banner warn" style={{ margin: "10px 0" }}>
              <strong>⏰ Expired Credential:</strong> This attestation reached its expiration date ({attestationInfo.expiresAt}).
            </div>
          )}

          <div className="stats-grid" style={{ marginTop: "1rem" }}>
            <div className="stat-box">
              <span className="stat-label">Issuing Employer</span>
              <span className="stat-value" style={{ fontSize: "0.9rem" }}>
                <code>{attestationInfo.attester.slice(0, 6)}...{attestationInfo.attester.slice(-4)}</code>
              </span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Employer Reputation</span>
              <span className="stat-value font-highlight">⭐ {attestationInfo.reputation}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Employer Staked Collateral</span>
              <span className="stat-value">{attestationInfo.attesterStake} ETH</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Validity Window</span>
              <span className="stat-value" style={{ fontSize: "0.85rem" }}>
                {attestationInfo.issuedAt} → {attestationInfo.expiresAt}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Identity Verification Check (Proof-of-Possession / Anti-Replay) */}
      {vpCheck && (
        <section className="card">
          <h3>Subject Identity Verification (Anti-Replay)</h3>
          {vpCheck.hasPresentation ? (
            vpCheck.valid ? (
              <div className="verification-status-box success">
                <div className="status-title">✅ Subject Wallet Ownership Confirmed</div>
                <p className="hint">
                  The applicant cryptographically proved possession of subject wallet{" "}
                  <code>{vpCheck.signer}</code> with an EIP-712 challenge signature. This proof bundle cannot be stolen or forged by an unauthorized third party.
                </p>
                {vpCheck.verifierTarget !== ethers.ZeroAddress && (
                  <div className="small hint">
                    Challenge Target: <code>{vpCheck.verifierTarget}</code>
                  </div>
                )}
              </div>
            ) : (
              <div className="verification-status-box failure">
                <div className="status-title">❌ Security Warning: Presentation Signature Invalid</div>
                <p className="hint">
                  {vpCheck.reason || "The presenter signature does not match the subject wallet registered on-chain!"}
                </p>
              </div>
            )
          ) : (
            <div className="verification-status-box notice">
              <div className="status-title">ℹ️ Unsigned Disclosure Bundle</div>
              <p className="hint">
                This is a raw selective-disclosure bundle without an EIP-712 subject presentation signature.
                Merkle field authenticity is verified, but subject wallet possession was not challenged.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Disclosed Fields & Zero-Knowledge Predicates */}
      {results && (
        <section className="card">
          <h3>Cryptographically Verified Disclosures</h3>
          <p className="hint">
            Each leaf below is independently verified against the on-chain Merkle root signed by the employer.
          </p>

          <table className="field-table">
            <thead>
              <tr>
                <th>Field / Milestone</th>
                <th>Disclosed Value</th>
                <th>Merkle Integrity</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                let displayLabel = r.fieldName;
                let displayValue = r.fieldValue;

                if (r.isPredicate) {
                  displayLabel = (
                    <span>
                      🛡️{" "}
                      {r.fieldName
                        .replace("predicate:rating_gte_", "Certified Rating ≥ ")
                        .replace("predicate:tenure_months_gte_", "Certified Tenure ≥ ") +
                        (r.fieldName.includes("tenure") ? " Months" : " / 5.0")}
                    </span>
                  );
                  displayValue = (
                    <span className="badge badge-success">
                      {r.fieldValue === "true" ? "Criterion Met (Verified)" : "Not Met"}
                    </span>
                  );
                }

                return (
                  <tr key={r.fieldName}>
                    <td>
                      <strong>{displayLabel}</strong>
                    </td>
                    <td>{displayValue}</td>
                    <td>
                      <span className={`badge ${r.valid ? "badge-success" : "badge-danger"}`}>
                        {r.valid ? "Valid (On-Chain Root)" : "INVALID / TAMPERED"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {log && <p className="log">{log}</p>}
    </div>
  );
}
