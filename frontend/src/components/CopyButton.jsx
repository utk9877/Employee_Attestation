import { useState } from "react";

export default function CopyButton({ value }) {
  const [status, setStatus] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied");
    } catch {
      setStatus("Copy failed");
    }
    window.setTimeout(() => setStatus(""), 1800);
  }

  return (
    <span className="copy-control">
      <button type="button" onClick={handleCopy}>
        Copy JSON
      </button>
      {status && <span className="copy-status">{status}</span>}
    </span>
  );
}
