import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { buildCredentialTree } from "../lib/merkleCredential";
import CopyButton from "./CopyButton";

const EMPTY_FIELD = { fieldName: "", fieldValue: "" };

export default function AttesterPanel() {
  const { address, signer, contracts } = useWallet();
  const [status, setStatus] = useState(null); // { registered, stake, reputation }
  const [minStake, setMinStake] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const [subject, setSubject] = useState("");
  const [fields, setFields] = useState([
    { fieldName: "employer", fieldValue: "" },
    { fieldName: "role", fieldValue: "" },
    { fieldName: "startDate", fieldValue: "" },
    { fieldName: "endDate", fieldValue: "" },
    { fieldName: "performanceRating", fieldValue: "" },
  ]);
  const [issuedBlob, setIssuedBlob] = useState(null);

  async function refreshStatus() {
    if (!contracts || !address) return;
    const [registered, stake, reputation, min] = await Promise.all([
      contracts.attesterRegistry.isRegistered(address),
      contracts.attesterRegistry.stakeOf(address),
      contracts.attesterRegistry.reputationOf(address),
      contracts.attesterRegistry.MIN_STAKE(),
    ]);
    setStatus({ registered, stake, reputation });
    setMinStake(min);
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, address]);

  async function handleRegister() {
    setBusy(true);
    setLog("Registering as attester...");
    try {
      const tx = await contracts.attesterRegistry.registerAttester({ value: minStake });
      await tx.wait();
      setLog("Registered.");
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
    setLog("Building credential tree and signing root...");
    setIssuedBlob(null);
    try {
      if (!ethers.isAddress(subject)) throw new Error("Enter a valid subject (employee) address");

      const credential = {};
      for (const f of fields) {
        if (!f.fieldName) continue;
        credential[f.fieldName] = f.fieldValue;
      }
      if (Object.keys(credential).length === 0) throw new Error("Add at least one field");

      const { root, fields: builtFields } = buildCredentialTree(credential);
      const signature = await signer.signMessage(ethers.getBytes(root));

      setLog("Submitting attestation on-chain...");
      const tx = await contracts.attestationRegistry.issueAttestation(subject, root, signature);
      const receipt = await tx.wait();

      let attestationId = null;
      for (const l of receipt.logs) {
        try {
          const parsed = contracts.attestationRegistry.interface.parseLog(l);
          if (parsed?.name === "AttestationIssued") {
            attestationId = parsed.args.attestationId.toString();
          }
        } catch {
          /* not our event */
        }
      }

      const blob = {
        attestationId,
        subject,
        attester: address,
        root,
        fields: builtFields,
      };
      setIssuedBlob(blob);
      setLog(`Attestation #${attestationId} issued. Share the blob below with the employee.`);
    } catch (e) {
      setLog("Error: " + (e.shortMessage || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!address) return <p className="hint">Connect your wallet to act as an attester (employer).</p>;

  return (
    <div className="panel">
      <h2>Attester (Employer)</h2>

      <section className="card">
        <h3>Registration</h3>
        {status && (
          <ul className="stat-list">
            <li>Registered: {status.registered ? "Yes" : "No"}</li>
            <li>Stake: {status.stake !== undefined ? ethers.formatEther(status.stake) : "-"} ETH</li>
            <li>Reputation: {status.reputation?.toString?.() ?? "-"}</li>
          </ul>
        )}
        {status && !status.registered && (
          <button disabled={busy || !minStake} onClick={handleRegister}>
            Register (stake {minStake ? ethers.formatEther(minStake) : "..."} ETH)
          </button>
        )}
      </section>

      <section className="card">
        <h3>Issue Attestation</h3>
        <label>
          Employee (subject) address
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="0x..." />
        </label>

        <table className="field-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
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
                    placeholder="fieldName"
                  />
                </td>
                <td>
                  <input
                    value={f.fieldValue}
                    onChange={(e) => updateField(i, "fieldValue", e.target.value)}
                    placeholder="value"
                  />
                </td>
                <td>
                  <button className="link" onClick={() => removeField(i)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link" onClick={addField}>
          + add field
        </button>

        <div>
          <button disabled={busy || !status?.registered} onClick={handleIssue}>
            Sign &amp; Issue Attestation
          </button>
          {status && !status.registered && <p className="hint">Register as an attester first.</p>}
        </div>

        {issuedBlob && (
          <div>
            <p>
              Share this credential blob with the employee (they'll paste it into the Employee tab).
              This never touches the chain — only its Merkle root did.
            </p>
              <textarea readOnly rows={10} value={JSON.stringify(issuedBlob, null, 2)} />
              <CopyButton value={JSON.stringify(issuedBlob, null, 2)} />
          </div>
        )}
      </section>

      {log && <p className="log">{log}</p>}
    </div>
  );
}
