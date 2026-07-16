"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtTime, fmtDateTime } from "@/lib/api";
import { Tile } from "@/components/ui";

function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDay(day) {
  return new Date(`${day}T00:00:00`).toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

/** Cross-session attendance dashboard — embedded in the Face Attendance workspace. */
export default function AttendanceView() {
  const today = isoDay(new Date());
  const weekAgo = isoDay(new Date(Date.now() - 6 * 24 * 3600 * 1000));

  const [person, setPerson] = useState("");
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [identities, setIdentities] = useState([]);
  const [data, setData] = useState(null); // { records, unknown, summary }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/faces").then(setIdentities).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (person) params.set("person", person);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    api(`/attendance?${params}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [person, dateFrom, dateTo]);

  const records = data?.records || [];
  const summary = data?.summary || {};
  const unknown = data?.unknown || { daily: [], recent: [], total: 0 };

  // group per-day for the daily summary view (records arrive newest day first)
  const days = [];
  const byDay = new Map();
  for (const r of records) {
    if (!byDay.has(r.day)) {
      byDay.set(r.day, []);
      days.push(r.day);
    }
    byDay.get(r.day).push(r);
  }
  const unknownByDay = Object.fromEntries(unknown.daily.map((u) => [u.day, u.count]));
  const presentToday = new Set(records.filter((r) => r.day === today).map((r) => r.name)).size;

  return (
    <>
      <div className="toolbar">
        <div>
          <label className="field-label" htmlFor="person">Person</label>
          <select id="person" className="select" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {identities.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="from">From</label>
          <input id="from" type="date" className="input" value={dateFrom} max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">To</label>
          <input id="to" type="date" className="input" value={dateTo} min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button type="button" className="btn sm" onClick={() => { setDateFrom(today); setDateTo(today); }}>
          Today
        </button>
        <button type="button" className="btn sm" onClick={() => { setDateFrom(weekAgo); setDateTo(today); }}>
          Last 7 days
        </button>
        <button type="button" className="btn sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
          All time
        </button>
      </div>

      {error && <p className="error-text" style={{ marginBottom: 14 }}>{error}</p>}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile label="Present today" value={presentToday} />
        <Tile label="Check-ins" value={summary.check_ins ?? 0} sub="in range" />
        <Tile label="Unknown detections" value={unknown.total} sub="in range" />
        <Tile label="Active days" value={summary.days ?? 0} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)", alignItems: "start" }}>
        <div>
          {loading && !data ? (
            <div className="card"><p className="empty">Loading attendance…</p></div>
          ) : days.length === 0 ? (
            <div className="card">
              <h3>Daily attendance</h3>
              <p className="empty">No attendance records match these filters. Run a Face Attendance session first.</p>
            </div>
          ) : (
            days.map((day) => (
              <div className="card" style={{ marginBottom: 14 }} key={day}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ marginBottom: 0 }}>{fmtDay(day)}</h3>
                  <span className="muted">
                    {byDay.get(day).length} present
                    {unknownByDay[day] ? ` · ${unknownByDay[day]} unknown` : ""}
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Name</th><th>Arrived</th><th>Last seen</th><th>Check-ins</th></tr>
                    </thead>
                    <tbody>
                      {byDay.get(day).map((r) => (
                        <tr key={`${r.day}-${r.name}`}>
                          <td><strong>{r.name}</strong></td>
                          <td className="num">{fmtTime(r.first_seen)}</td>
                          <td className="num">{fmtTime(r.last_seen)}</td>
                          <td className="num">{r.check_ins}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h3>Unknown faces · {unknown.total}</h3>
          {unknown.recent.length === 0 ? (
            <p className="empty">No unknown faces detected in this range.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="data">
                <thead>
                  <tr><th>Detected</th><th>Session</th></tr>
                </thead>
                <tbody>
                  {unknown.recent.map((u, i) => (
                    <tr key={`${u.session_id}-${u.ts}-${i}`}>
                      <td className="num">{fmtDateTime(u.ts)}</td>
                      <td>
                        <Link href={`/session/${u.session_id}`} style={{ color: "var(--accent)" }}>
                          view session
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ marginTop: 10 }}>
            Unknown faces are people in view who don’t match any enrolled identity.
            Enroll them on the People tab to start tracking their attendance.
          </p>
        </div>
      </div>
    </>
  );
}
