"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export default function FacesPage() {
  const [identities, setIdentities] = useState([]);
  const [name, setName] = useState("");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState(null); // { kind: "ok" | "warn" | "error", text }
  const fileInput = useRef(null);

  const refresh = () => api("/faces").then(setIdentities).catch(() => {});
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function clearForm() {
    setName("");
    setFiles([]);
    if (fileInput.current) fileInput.current.value = "";
  }

  const canEnroll = name.trim() && files.length > 0 && !busy;

  async function enroll(e) {
    e.preventDefault();
    if (!canEnroll) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const res = await api(`/faces/${encodeURIComponent(name.trim())}`, {
        method: "POST",
        body: form,
      });
      setMessage(
        res.rebuilt
          ? { kind: "ok", text: `Saved ${res.saved} photo(s) for “${res.name}”. Embeddings rebuilt — ${res.identities} identities ready for recognition.` }
          : { kind: "warn", text: `Saved ${res.saved} photo(s) for “${res.name}”. ${res.note}` }
      );
      clearForm();
      refresh();
    } catch (err) {
      setMessage({ kind: "error", text: `Enrollment failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function removePerson(person) {
    if (!window.confirm(`Delete all photos for “${person}”? They will no longer be recognized.`)) return;
    setMessage(null);
    try {
      const res = await api(`/faces/${encodeURIComponent(person)}`, { method: "DELETE" });
      setMessage(
        res.rebuilt
          ? { kind: "ok", text: `Deleted “${person}”. Embeddings rebuilt.` }
          : { kind: "warn", text: `Deleted “${person}”. ${res.note}` }
      );
      refresh();
    } catch (err) {
      setMessage({ kind: "error", text: `Delete failed: ${err.message}` });
    }
  }

  async function rebuild() {
    setRebuilding(true);
    setMessage(null);
    try {
      const res = await api("/faces/rebuild", { method: "POST" });
      setMessage({ kind: "ok", text: `Embeddings rebuilt — ${res.identities} identities: ${res.names.join(", ") || "none"}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err.message });
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <>
      <h1 className="page-title">People</h1>
      <p className="page-sub">
        Enroll a person with several photos from different angles. The name becomes the label
        shown when they are recognized; anyone else is labeled “Unknown”.
      </p>

      {message && <p className={`notice ${message.kind}`} style={{ marginBottom: 14 }}>{message.text}</p>}

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <form className="card" onSubmit={enroll}>
          <h3>Enroll a person</h3>
          <label className="field-label" htmlFor="person-name">Name</label>
          <input
            id="person-name"
            className="input"
            placeholder="e.g. asad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <label className="field-label">Photos (multiple angles work best)</label>
          <div className="row" style={{ marginBottom: 10 }}>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              🖼 Choose photos
            </button>
            <span className="muted">
              {files.length > 0 ? `${files.length} photo(s) selected` : "JPG, PNG, BMP or WebP"}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </div>
          {previews.length > 0 && (
            <div className="thumbs" style={{ marginBottom: 12 }}>
              {previews.map((src, i) => (
                <img key={src} src={src} alt={`Selected photo ${i + 1}`} />
              ))}
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn primary" disabled={!canEnroll}>
              {busy ? "Enrolling…" : "＋ Enroll person"}
            </button>
            {files.length > 0 && (
              <button type="button" className="btn sm" onClick={clearForm} disabled={busy}>
                Clear
              </button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Embeddings are rebuilt automatically after enrollment. On engines without the face
            stack (e.g. this Windows dev machine), photos are still saved — rebuild later where
            recognition runs (Docker).
          </p>
        </form>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ marginBottom: 0 }}>Enrolled identities · {identities.length}</h3>
            <button type="button" className="btn sm" onClick={rebuild} disabled={rebuilding}>
              {rebuilding ? "Rebuilding…" : "⟳ Rebuild embeddings"}
            </button>
          </div>
          {identities.length === 0 ? (
            <p className="empty">Nobody enrolled yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Name</th><th>Photos</th><th></th></tr>
                </thead>
                <tbody>
                  {identities.map((p) => (
                    <tr key={p.name}>
                      <td><strong>{p.name}</strong></td>
                      <td className="num">{p.samples}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="btn sm danger" onClick={() => removePerson(p.name)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
