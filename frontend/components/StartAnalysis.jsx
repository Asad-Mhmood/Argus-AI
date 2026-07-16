"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/**
 * Source picker + start button for one fixed use case.
 * The module workspace embeds this in its Monitor tab.
 */
export default function StartAnalysis({ useCase }) {
  const router = useRouter();
  const [sourceTab, setSourceTab] = useState("upload");
  const [rtspUrl, setRtspUrl] = useState("");
  const [uploadList, setUploadList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    api("/videos").then(setUploadList).catch(() => {});
  }, []);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await api("/videos", { method: "POST", body: form });
      setUploadList((l) => [saved, ...l]);
      setSelectedFile(saved.name);
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const source = sourceTab === "rtsp" ? rtspUrl.trim() : selectedFile;
  const canStart = source && !starting;

  async function startSession() {
    setStarting(true);
    setError(null);
    try {
      const s = await api("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_case: useCase, source_type: sourceTab, source }),
      });
      router.push(`/session/${s.id}`);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  return (
    <div className="card">
      <h3>Start analysis</h3>
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="tabs">
        {[
          ["upload", "Upload recording"],
          ["rtsp", "Live IP camera"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab ${sourceTab === key ? "active" : ""}`}
            onClick={() => { setSourceTab(key); setSelectedFile(null); }}
          >
            {label}
          </button>
        ))}
      </div>

      {sourceTab === "rtsp" && (
        <div style={{ maxWidth: 560 }}>
          <label className="field-label" htmlFor="rtsp">RTSP / HTTP stream URL</label>
          <input
            id="rtsp"
            className="input"
            placeholder="rtsp://user:password@192.168.1.50:554/stream1"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
          />
          <p className="muted" style={{ marginTop: 6 }}>
            The camera must be reachable from the machine running the engine.
          </p>
        </div>
      )}

      {sourceTab === "upload" && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "⬆ Upload video file"}
            </button>
            <span className="muted">MP4, AVI, MOV, MKV or WebM</span>
            <input ref={fileInput} type="file" accept="video/*" hidden onChange={handleUpload} />
          </div>
          <FilePick
            list={uploadList}
            selected={selectedFile}
            onSelect={setSelectedFile}
            empty="No uploads yet — upload a recording to analyse."
          />
        </div>
      )}

      <div className="row mt">
        <button type="button" className="btn primary" disabled={!canStart} onClick={startSession}>
          {starting ? "Starting…" : "▶ Start analysis"}
        </button>
        {!source && <span className="muted">Select a video source first.</span>}
      </div>
    </div>
  );
}

function FilePick({ list, selected, onSelect, empty }) {
  if (list.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="row">
      {list.map((f) => (
        <button
          key={f.name}
          type="button"
          className={`btn sm ${selected === f.name ? "primary" : ""}`}
          onClick={() => onSelect(f.name)}
        >
          🎬 {f.name} <small>({f.size_mb} MB)</small>
        </button>
      ))}
    </div>
  );
}
