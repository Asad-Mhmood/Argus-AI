"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fmtDateTime, USE_CASE_COLORS, USE_CASE_LABELS } from "@/lib/api";
import { StatusBadge } from "@/components/ui";

export default function Dashboard() {
  const router = useRouter();
  const [useCases, setUseCases] = useState([]);
  const [sessions, setSessions] = useState({ live: [], history: [] });
  const [useCase, setUseCase] = useState(null);
  const [sourceTab, setSourceTab] = useState("upload");
  const [rtspUrl, setRtspUrl] = useState("");
  const [uploadList, setUploadList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  const refreshSessions = () => api("/sessions").then(setSessions).catch(() => {});

  useEffect(() => {
    api("/usecases").then(setUseCases).catch(() => setError("Cannot reach the backend engine. Is it running?"));
    api("/videos").then(setUploadList).catch(() => {});
    refreshSessions();
    const t = setInterval(refreshSessions, 5000);
    return () => clearInterval(t);
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

  const source =
    sourceTab === "rtsp" ? rtspUrl.trim() : selectedFile;
  const canStart = useCase && source && !starting;

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
    <>
      <h1 className="page-title">New Analysis</h1>
      <p className="page-sub">Choose a use case, pick a video source, and start monitoring.</p>
      {error && <p className="error-text" style={{ marginBottom: 14 }}>{error}</p>}

      {/* Step 1 — use case */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>1 · Use case</h3>
        <div className="grid cols-4">
          {useCases.map((uc) => (
            <button
              key={uc.key}
              type="button"
              className={`uc-card ${useCase === uc.key ? "selected" : ""}`}
              onClick={() => setUseCase(uc.key)}
            >
              <div className="swatch" style={{ background: USE_CASE_COLORS[uc.key] }} />
              <div className="t">{uc.title}</div>
              <div className="d">{uc.description}</div>
            </button>
          ))}
          {useCases.length === 0 && !error && <p className="muted">Loading use cases…</p>}
        </div>
      </div>

      {/* Step 2 — source */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>2 · Video source</h3>
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
            <FilePick list={uploadList} selected={selectedFile} onSelect={setSelectedFile} empty="No uploads yet." />
          </div>
        )}
      </div>

      {/* Step 3 — start */}
      <div className="row" style={{ marginBottom: 34 }}>
        <button type="button" className="btn primary" disabled={!canStart} onClick={startSession}>
          {starting ? "Starting…" : "▶ Start analysis"}
        </button>
        {!useCase && <span className="muted">Select a use case first.</span>}
        {useCase && !source && <span className="muted">Select a video source.</span>}
      </div>

      {/* Sessions */}
      <div className="grid cols-2">
        <SessionTable title="Running now" rows={sessions.live} empty="No active sessions." />
        <SessionTable title="Recent sessions" rows={sessions.history.slice(0, 8)} empty="Nothing yet — start your first analysis." />
      </div>
    </>
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

function SessionTable({ title, rows, empty }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Use case</th><th>Source</th><th>Started</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/session/${s.id}`}>
                      <span className="chip" style={{ background: USE_CASE_COLORS[s.use_case] }} />
                      {USE_CASE_LABELS[s.use_case] || s.use_case}
                    </Link>
                  </td>
                  <td className="muted">{s.source_type}</td>
                  <td className="num">{fmtDateTime(s.started_at || s.created_at)}</td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
