"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, apiUrl, ZONE_COLORS } from "@/lib/api";

/**
 * Source picker + start button for one fixed use case.
 * The module workspace embeds this in its Monitor tab.
 * For ANPR the user can also draw labeled detection zones on a preview frame.
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
  const [zones, setZones] = useState([]);
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
        body: JSON.stringify({
          use_case: useCase,
          source_type: sourceTab,
          source,
          ...(useCase === "anpr" && zones.length > 0 ? { zones } : {}),
        }),
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
            onClick={() => { setSourceTab(key); setSelectedFile(null); setZones([]); }}
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
            onSelect={(name) => { setSelectedFile(name); setZones([]); }}
            empty="No uploads yet — upload a recording to analyse."
          />
        </div>
      )}

      {useCase === "anpr" && source && (
        <ZoneEditor
          sourceType={sourceTab}
          source={source}
          zones={zones}
          setZones={setZones}
        />
      )}

      <div className="row mt">
        <button type="button" className="btn primary" disabled={!canStart} onClick={startSession}>
          {starting ? "Starting…" : "▶ Start analysis"}
        </button>
        {!source && <span className="muted">Select a video source first.</span>}
        {useCase === "anpr" && source && (
          <span className="muted">
            {zones.length > 0
              ? `Detection limited to ${zones.length} zone${zones.length > 1 ? "s" : ""}.`
              : "No zones drawn — the whole frame is analysed."}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Draw labeled detection rectangles directly on a preview frame of the source.
 * Zones are stored normalized (0..1) so they are resolution-independent.
 */
function ZoneEditor({ sourceType, source, zones, setZones }) {
  const [preview, setPreview] = useState(null); // object URL
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null); // rect being dragged
  const canvasRef = useRef(null);
  const dragStart = useRef(null);

  // a different source means a different frame — drop the stale preview
  useEffect(() => {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setError(null);
  }, [sourceType, source]);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: sourceType, source }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      const blob = await res.blob();
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function toNorm(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = toNorm(e);
    setDraft({ ...dragStart.current, w: 0, h: 0 });
  }

  function onMouseMove(e) {
    if (!dragStart.current) return;
    const p = toNorm(e);
    const s = dragStart.current;
    setDraft({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }

  function onMouseUp() {
    if (!dragStart.current) return;
    const d = draft;
    dragStart.current = null;
    setDraft(null);
    if (d && d.w > 0.02 && d.h > 0.02) {
      setZones((z) => [...z, { label: `Zone ${z.length + 1}`, ...d }]);
    }
  }

  const rects = draft ? [...zones, { label: "", ...draft }] : zones;

  return (
    <div className="zone-editor">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="field-label" style={{ marginBottom: 0 }}>Detection zones (optional)</span>
        <button type="button" className="btn sm" onClick={loadPreview} disabled={loading}>
          {loading ? "Loading frame…" : preview ? "↻ Reload frame" : "▦ Load preview & draw zones"}
        </button>
        {zones.length > 0 && (
          <button type="button" className="btn sm" onClick={() => setZones([])}>✕ Clear all</button>
        )}
      </div>
      {error && <p className="error-text" style={{ marginBottom: 8 }}>{error}</p>}
      {!preview && !error && (
        <p className="muted" style={{ marginBottom: 4 }}>
          Load a preview frame, then drag rectangles over the areas to watch
          (e.g. an Entry lane and an Exit lane). Plates outside your zones are ignored.
        </p>
      )}

      {preview && (
        <div
          className="zone-canvas"
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <img src={preview} alt="Video preview frame" draggable={false} />
          {rects.map((z, i) => (
            <div
              key={i}
              className="zone-box"
              style={{
                "--zc": ZONE_COLORS[i % ZONE_COLORS.length],
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.w * 100}%`,
                height: `${z.h * 100}%`,
              }}
            >
              {z.label && <span className="tag">{z.label}</span>}
            </div>
          ))}
        </div>
      )}

      {zones.length > 0 && (
        <div className="zone-list">
          {zones.map((z, i) => (
            <div key={i} className="zone-row">
              <span className="chip" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
              <input
                className="input sm"
                value={z.label}
                aria-label={`Zone ${i + 1} name`}
                onChange={(e) =>
                  setZones((zs) => zs.map((zz, j) => (j === i ? { ...zz, label: e.target.value } : zz)))
                }
              />
              <button
                type="button"
                className="btn sm"
                onClick={() => setZones((zs) => zs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
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
