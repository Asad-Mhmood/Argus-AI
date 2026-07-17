"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  apiUrl, api, fmtDateTime, fmtDuration, fmtTime,
  USE_CASE_COLORS, USE_CASE_LABELS, USE_CASE_TITLES,
} from "@/lib/api";
import { StatusBadge, Tile } from "@/components/ui";

export default function SessionPage() {
  const { id } = useParams();
  const [data, setData] = useState(null); // { session, stats }
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    api(`/sessions/${id}/stats`).then(setData).catch((e) => setError(e.message));
    api(`/events?session_id=${id}&limit=50`).then(setEvents).catch(() => {});
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <p className="muted">Loading session…</p>;

  const { session, stats } = data;
  const live = session.status === "running" || session.status === "starting";

  return (
    <>
      <Link href={`/module/${session.use_case}`} className="backlink">
        ← {USE_CASE_TITLES[session.use_case] || "Module"}
      </Link>
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          <span className="chip" style={{ background: USE_CASE_COLORS[session.use_case], width: 12, height: 12 }} />
          {USE_CASE_LABELS[session.use_case] || session.use_case}
        </h1>
        <StatusBadge status={session.status} />
      </div>
      <p className="page-sub">
        {session.source_type === "rtsp" ? "Live camera"
          : session.source_type === "browser" ? "Browser camera"
          : session.source_type === "upload" ? "Uploaded video" : "Demo video"}
        {" · started "}{fmtDateTime(session.started_at || session.created_at)}
        {session.frames_processed != null && <> · {session.frames_processed} frames analysed</>}
      </p>
      {session.error && <p className="error-text" style={{ marginBottom: 12 }}>{session.error}</p>}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)" }}>
        <div>
          {live || session.frames_processed > 0 ? (
            // MJPEG while live; final snapshot afterwards
            <img
              className="live-frame"
              src={`${apiUrl()}/api/sessions/${id}/${live ? "stream" : "snapshot"}`}
              alt="Annotated video feed"
            />
          ) : (
            <div className="card empty">
              {live && session.source_type === "browser"
                ? "Waiting for your camera…"
                : "No frames available for this session."}
            </div>
          )}
          {live && session.source_type === "browser" && <CameraSender sessionId={id} />}
          <div className="row mt">
            {live && (
              <button
                type="button"
                className="btn danger"
                onClick={() => api(`/sessions/${id}/stop`, { method: "POST" }).then(refresh)}
              >
                ■ Stop session
              </button>
            )}
            <a className="btn" href={`${apiUrl()}/api/events/export?session_id=${id}`}>
              ⬇ Export CSV
            </a>
          </div>
        </div>

        <div>
          <StatsPanel useCase={session.use_case} stats={stats} />
          <div className="card mt">
            <h3>Event feed</h3>
            <EventList events={events} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Streams the viewer's camera to the engine at ~2 fps (JPEG frames over HTTP)
 * for sessions created with source_type "browser". The annotated result comes
 * back through the normal MJPEG stream above.
 */
function CameraSender({ sessionId }) {
  const videoRef = useRef(null);
  const [facing, setFacing] = useState("user");
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start() {
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (err) {
        setError(
          err.name === "NotAllowedError"
            ? "Camera access was denied — allow it in your browser and reload."
            : `Camera unavailable: ${err.message}`
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      try { await video.play(); } catch {}
      setActive(true);
      timer = setInterval(() => {
        if (stopped || !video.videoWidth) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob || stopped) return;
            fetch(`${apiUrl()}/api/sessions/${sessionId}/frames`, {
              method: "POST",
              body: blob,
            }).catch(() => {});
          },
          "image/jpeg",
          0.8
        );
      }, 500);
    }

    start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setActive(false);
    };
  }, [sessionId, facing]);

  return (
    <div className="card mt" style={{ padding: 12 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: 120,
            borderRadius: 6,
            transform: facing === "user" ? "scaleX(-1)" : "none",
          }}
        />
        <div>
          {error ? (
            <p className="error-text">{error}</p>
          ) : (
            <p className="muted" style={{ marginBottom: 6 }}>
              {active ? "● Sending your camera to the engine" : "Starting camera…"}
              <br />
              Keep this page open — closing it ends the stream.
            </p>
          )}
          <button
            type="button"
            className="btn sm"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            ⟲ Flip camera
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- use-case specific panels ---------- */

function StatsPanel({ useCase, stats }) {
  if (!stats || Object.keys(stats).length === 0)
    return <div className="card"><h3>Statistics</h3><p className="empty">Warming up…</p></div>;
  switch (useCase) {
    case "face_attendance": return <AttendancePanel stats={stats} />;
    case "ppe": return <PPEPanel stats={stats} />;
    case "activity": return <ActivityPanel stats={stats} />;
    case "anpr": return <ANPRPanel stats={stats} />;
    default: return null;
  }
}

function AttendancePanel({ stats }) {
  const people = stats.people || [];
  return (
    <>
      <div className="grid cols-2">
        <Tile label="Enrolled identities" value={stats.enrolled ?? "—"} />
        <Tile label="Seen this session" value={people.length} />
        <Tile label="Unknown detections" value={stats.unknown_detections ?? 0} />
      </div>
      <div className="card mt">
        <h3>Attendance log</h3>
        {people.length === 0 ? (
          <p className="empty">No enrolled faces recognized yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>First seen</th><th>Last seen</th><th>Status</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{fmtTime(p.first_seen)}</td>
                    <td className="num">{fmtTime(p.last_seen)}</td>
                    <td>
                      {"present" in p
                        ? <span className={`badge ${p.present ? "running" : "stopped"}`}><span className="pip" />{p.present ? "present" : "away"}</span>
                        : <span className="muted">{p.sightings} sightings</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function PPEPanel({ stats }) {
  const rate = stats.compliance_rate;
  return (
    <>
      <div className="grid cols-2">
        <Tile
          label="Compliance rate"
          value={rate == null ? "—" : `${(rate * 100).toFixed(1)}%`}
        />
        <Tile label="Violations detected" value={stats.violation_detections ?? 0} />
      </div>
      <div className="card mt">
        <h3>Detections by class</h3>
        {stats.class_counts && Object.keys(stats.class_counts).length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Class</th><th>Count</th><th>Type</th></tr></thead>
              <tbody>
                {Object.entries(stats.class_counts).map(([name, count]) => {
                  const isViolation = (stats.violation_classes || []).includes(name);
                  return (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{count}</td>
                      <td>{isViolation
                        ? <span className="badge alert"><span className="pip" />violation</span>
                        : <span className="badge running"><span className="pip" />compliant</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No gear detected yet.</p>
        )}
      </div>
    </>
  );
}

function ActivityPanel({ stats }) {
  return (
    <>
      <div className="grid cols-2">
        <Tile label="Active workers" value={stats.active ?? 0} sub={`of ${stats.people_in_view ?? 0} in view`} />
        <Tile label="Idle workers" value={stats.idle ?? 0} sub={`${stats.total_idle_events ?? 0} idle events`} />
      </div>
      <div className="card mt">
        <h3>People in view</h3>
        {(stats.persons || []).length === 0 ? (
          <p className="empty">Nobody detected right now.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>ID</th><th>Status</th><th>Idle for</th></tr></thead>
              <tbody>
                {stats.persons.map((p) => (
                  <tr key={p.label}>
                    <td>{p.label}</td>
                    <td>
                      <span className={`badge ${p.status === "idle" ? "alert" : "running"}`}>
                        <span className="pip" />{p.status}
                      </span>
                    </td>
                    <td className="num">{p.status === "idle" ? fmtDuration(p.idle_seconds) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ANPRPanel({ stats }) {
  const [zoneFilter, setZoneFilter] = useState("");
  const plates = stats.plates || [];
  const pending = stats.pending || [];
  const zones = stats.zones || [];
  const shownPlates = zoneFilter ? plates.filter((p) => p.zone === zoneFilter) : plates;
  const shownPending = zoneFilter ? pending.filter((p) => p.zone === zoneFilter) : pending;
  return (
    <>
      <div className="grid cols-2">
        <Tile label="Vehicles logged" value={stats.unique_plates ?? 0} />
        <Tile
          label="In view now"
          value={stats.in_view ?? 0}
          sub={pending.length > 0 ? `${pending.length} being read` : undefined}
        />
      </div>
      <div className="card mt">
        <h3>Vehicle log</h3>
        {zones.length > 0 && (
          <div className="filter-chips">
            {["", ...zones].map((z) => (
              <button
                key={z || "all"}
                type="button"
                className={`chip-btn ${zoneFilter === z ? "active" : ""}`}
                onClick={() => setZoneFilter(z)}
              >
                {z || "All zones"}
              </button>
            ))}
          </div>
        )}
        {shownPlates.length === 0 && shownPending.length === 0 ? (
          <p className="empty">No plates read yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plate</th>
                  {zones.length > 0 && <th>Zone</th>}
                  <th>First seen</th>
                  <th>Confidence</th>
                  <th>Reads</th>
                </tr>
              </thead>
              <tbody>
                {shownPending.map((p, i) => (
                  <tr key={`pending-${i}`} className="pending-row">
                    <td>
                      <strong>{p.plate ?? "· · ·"}</strong>{" "}
                      <span className="muted">reading…</span>
                    </td>
                    {zones.length > 0 && <td>{p.zone && <span className="zone-tag">{p.zone}</span>}</td>}
                    <td className="num">{fmtTime(p.first_seen)}</td>
                    <td className="num">—</td>
                    <td className="num">{p.reads}</td>
                  </tr>
                ))}
                {shownPlates.map((p, i) => (
                  <tr key={`${p.plate}-${p.first_seen ?? i}`}>
                    <td>
                      <div className="plate-cell">
                        {p.thumb && <img className="plate-thumb" src={p.thumb} alt="" />}
                        <strong>{p.plate}</strong>
                      </div>
                    </td>
                    {zones.length > 0 && <td>{p.zone && <span className="zone-tag">{p.zone}</span>}</td>}
                    <td className="num">{fmtTime(p.first_seen)}</td>
                    <td className="num">{p.confidence != null ? `${(p.confidence * 100).toFixed(0)}%` : "—"}</td>
                    <td className="num">{p.reads ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function EventList({ events }) {
  if (events.length === 0) return <p className="empty">No events yet.</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
      <table className="data">
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="num muted">{fmtTime(e.ts)}</td>
              <td>{e.type.replaceAll("_", " ")}</td>
              <td>
                <strong>{e.label}</strong>
                {e.extra?.zone && <span className="zone-tag">{e.extra.zone}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
