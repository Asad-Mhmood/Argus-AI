"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  apiUrl, api, fmtDateTime, fmtDuration, fmtTime,
  USE_CASE_COLORS, USE_CASE_LABELS,
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
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          <span className="chip" style={{ background: USE_CASE_COLORS[session.use_case], width: 12, height: 12 }} />
          {USE_CASE_LABELS[session.use_case] || session.use_case}
        </h1>
        <StatusBadge status={session.status} />
      </div>
      <p className="page-sub">
        {session.source_type === "rtsp" ? "Live camera" : session.source_type === "upload" ? "Uploaded video" : "Demo video"}
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
            <div className="card empty">No frames available for this session.</div>
          )}
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
  const plates = stats.plates || [];
  return (
    <>
      <div className="grid cols-2">
        <Tile label="Unique plates" value={stats.unique_plates ?? 0} />
        <Tile label="Last plate" value={plates[0]?.plate ?? "—"} />
      </div>
      <div className="card mt">
        <h3>Vehicle log</h3>
        {plates.length === 0 ? (
          <p className="empty">No plates read yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Plate</th><th>First seen</th><th>Last seen</th><th>Reads</th></tr></thead>
              <tbody>
                {plates.map((p) => (
                  <tr key={p.plate}>
                    <td><strong>{p.plate}</strong></td>
                    <td className="num">{fmtTime(p.first_seen)}</td>
                    <td className="num">{fmtTime(p.last_seen)}</td>
                    <td className="num">{p.count}</td>
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
              <td><strong>{e.label}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
