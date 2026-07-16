"use client";
import { useEffect, useState } from "react";
import {
  apiUrl, api, fmtDateTime, USE_CASE_COLORS, USE_CASE_LABELS,
} from "@/lib/api";
import StackedBarChart from "@/components/StackedBarChart";

const HOUR_OPTIONS = [
  [6, "Last 6 hours"],
  [24, "Last 24 hours"],
  [72, "Last 3 days"],
  [168, "Last 7 days"],
];

/**
 * Filterable event history: per-hour chart + searchable table + CSV export.
 * Pass useCase to lock the view to one module (hides the use-case filter);
 * omit it for the cross-module explorer on the status page.
 */
export default function EventsView({ useCase: lockedUseCase }) {
  const [hours, setHours] = useState(24);
  const [useCaseFilter, setUseCaseFilter] = useState("");
  const [q, setQ] = useState("");
  const [perHour, setPerHour] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const useCase = lockedUseCase || useCaseFilter;

  useEffect(() => {
    api(`/stats/summary?hours=${hours}`)
      .then((d) => setPerHour(d.per_hour))
      .catch(() => {});
  }, [hours]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ hours: String(hours), limit: "300" });
    if (useCase) params.set("use_case", useCase);
    if (q) params.set("q", q);
    const t = setTimeout(() => {
      api(`/events?${params}`)
        .then(setEvents)
        .catch(() => setEvents([]))
        .finally(() => setLoading(false));
    }, 250); // debounce the search box
    return () => clearTimeout(t);
  }, [hours, useCase, q]);

  const chartData = useCase ? perHour.filter((r) => r.use_case === useCase) : perHour;
  const exportParams = new URLSearchParams({ hours: String(hours) });
  if (useCase) exportParams.set("use_case", useCase);

  return (
    <>
      <div className="toolbar">
        <div>
          <label className="field-label" htmlFor="range">Time range</label>
          <select id="range" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOUR_OPTIONS.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
          </select>
        </div>
        {!lockedUseCase && (
          <div>
            <label className="field-label" htmlFor="uc">Use case</label>
            <select id="uc" className="select" value={useCaseFilter} onChange={(e) => setUseCaseFilter(e.target.value)}>
              <option value="">All use cases</option>
              {Object.entries(USE_CASE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="field-label" htmlFor="q">Search</label>
          <input
            id="q" className="input" placeholder="Name, plate, violation…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <a className="btn" href={`${apiUrl()}/api/events/export?${exportParams}`}>⬇ Export CSV</a>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Events per hour</h3>
        <StackedBarChart data={chartData} hours={hours} />
      </div>

      <div className="card">
        <h3>Events {loading ? "· loading…" : `· ${events.length}`}</h3>
        {events.length === 0 ? (
          <p className="empty">{loading ? "Loading…" : "No events match these filters."}</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Time</th>
                  {!lockedUseCase && <th>Use case</th>}
                  <th>Event</th>
                  <th>Label</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{fmtDateTime(e.ts)}</td>
                    {!lockedUseCase && (
                      <td>
                        <span className="chip" style={{ background: USE_CASE_COLORS[e.use_case] }} />
                        {USE_CASE_LABELS[e.use_case] || e.use_case}
                      </td>
                    )}
                    <td>{e.type.replaceAll("_", " ")}</td>
                    <td><strong>{e.label}</strong></td>
                    <td className="num">{e.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : "—"}</td>
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
