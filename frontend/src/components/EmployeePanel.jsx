import { useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { rebuildTree, buildDisclosure } from "../lib/merkleCredential";
import { saveCredential, getCredentials } from "../lib/storage";
import CopyButton from "./CopyButton";

export default function EmployeePanel() {
  const { address } = useWallet();
  const [importText, setImportText] = useState("");
  const [credentials, setCredentials] = useState([]);
  const [log, setLog] = useState("");
  const [selectedFields, setSelectedFields] = useState({}); // attestationId -> Set(fieldName)
  const [disclosureOutput, setDisclosureOutput] = useState({}); // attestationId -> blob

  useEffect(() => {
    if (address) setCredentials(getCredentials(address));
  }, [address]);

  function handleImport() {
    try {
      const record = JSON.parse(importText);
      if (!record.attestationId || !record.root || !Array.isArray(record.fields)) {
        throw new Error("That doesn't look like a VeriRef credential blob.");
      }
      saveCredential(address, record);
      setCredentials(getCredentials(address));
      setImportText("");
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

  function generateDisclosure(record) {
    const chosen = Array.from(selectedFields[record.attestationId] || []);
    if (chosen.length === 0) {
      setLog("Select at least one field to disclose.");
      return;
    }
    const tree = rebuildTree(record.fields);
    const disclosed = buildDisclosure(tree, record.fields, chosen);

    const blob = {
      attestationId: record.attestationId,
      subject: record.subject,
      attester: record.attester,
      disclosed,
    };
    setDisclosureOutput((prev) => ({ ...prev, [record.attestationId]: blob }));
  }

  if (!address) return <p className="hint">Connect your wallet to manage your credentials.</p>;

  return (
    <div className="panel">
      <h2>Employee (Credential Holder)</h2>

      <section className="card">
        <h3>Import a credential</h3>
        <p className="hint">
          Paste the JSON blob your employer shared after issuing an attestation about you.
        </p>
        <textarea
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste credential blob here..."
        />
        <button onClick={handleImport}>Import</button>
      </section>

      {credentials.map((record) => (
        <section className="card" key={record.attestationId}>
          <h3>Attestation #{record.attestationId}</h3>
          <p className="hint">
            From: {record.attester}
            <br />
            Root: {record.root}
          </p>

          <table className="field-table">
            <thead>
              <tr>
                <th>Disclose?</th>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {record.fields.map((f) => (
                <tr key={f.fieldName}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedFields[record.attestationId]?.has(f.fieldName) || false}
                      onChange={() => toggleField(record.attestationId, f.fieldName)}
                    />
                  </td>
                  <td>{f.fieldName}</td>
                  <td>{f.fieldValue}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={() => generateDisclosure(record)}>Generate Selective Disclosure</button>

          {disclosureOutput[record.attestationId] && (
            <div>
              <p>Share this proof bundle with a verifier. Undisclosed fields stay hidden.</p>
              <textarea
                readOnly
                rows={8}
                value={JSON.stringify(disclosureOutput[record.attestationId], null, 2)}
              />
              <CopyButton value={JSON.stringify(disclosureOutput[record.attestationId], null, 2)} />
            </div>
          )}
        </section>
      ))}

      {log && <p className="log">{log}</p>}
    </div>
  );
}
