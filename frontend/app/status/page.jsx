"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, apiUrl, USE_CASES, USE_CASE_COLORS } from "@/lib/api";
import { Tile, UseCaseIcon } from "@/components/ui";
import SessionTable from "@/components/SessionTable";
import EventsView from "@/components/EventsView";

export default function StatusPage() {
  const [engineUp, setEngineUp] = useState(null);
  const [sessions, setSessions] = useState({ live: [], history: [] });
  const [perHour, setPerHour] = useState([]);
  const [people, setPeople] = useState(null);
  const [uploads, setUploads] = useState(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api("/health").then(
        () => alive && setEngineUp(true),
        () => alive && setEngineUp(false),
      );
      api("/sessions").then((s) => alive && setSessions(s)).catch(() => {});
      api("/stats/summary?hours=24").then((d) => alive && setPerHour(d.per_hour)).catch(() => {});
    };
    refresh();
    api("/faces").then((f) => alive && setPeople(f.length)).catch(() => {});
    api("/videos").then((v) => alive && setUploads(v.length)).catch(() => {});
    const t = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const events24 = {};
  for (const r of perHour) {
    events24[r.use_case] = (events24[r.use_case] || 0) + r.count;
  }
  const total24 = Object.values(events24).reduce((a, b) => a + b, 0);
  const runningBy = {};
  for (const s of sessions.live) {
    runningBy[s.use_case] = (runningBy[s.use_case] || 0) + 1;
  }

  let engineHost = "";
  try { engineHost = new URL(apiUrl()).host; } catch {}

  return (
    <>
      <h1 className="page-title">System status</h1>
      <p className="page-sub">Engine health, activity across all modules, and the full event history.</p>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="k">Engine</div>
          <div className="v" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`pip ${engineUp === null ? "" : engineUp ? "ok" : "down"}`} />
            {engineUp === null ? "…" : engineUp ? "Online" : "Offline"}
          </div>
          <div className="muted" style={{ marginTop: 2 }}>{engineHost}</div>
        </div>
        <Tile label="Active sessions" value={sessions.live.length} />
        <Tile label="Events" value={total24} sub="last 24 h" />
        <Tile label="People enrolled" value={people ?? "—"} sub={uploads != null ? `${uploads} uploads` : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Module activity</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Module</th><th>Running sessions</th><th>Events (24 h)</th><th></th></tr>
            </thead>
            <tbody>
              {USE_CASES.map((uc) => (
                <tr key={uc.key}>
                  <td>
                    <span className="module-cell" style={{ "--mc": USE_CASE_COLORS[uc.key] }}>
                      <span className="icon"><UseCaseIcon useCase={uc.key} size={15} /></span>
                      {uc.title}
                    </span>
                  </td>
                  <td className="num">{runningBy[uc.key] || 0}</td>
                  <td className="num">{events24[uc.key] || 0}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/module/${uc.key}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 26 }}>
        <SessionTable title="Running now" rows={sessions.live} empty="No active sessions." />
        <SessionTable
          title="Recent sessions"
          rows={sessions.history.slice(0, 8)}
          empty="No sessions yet — open a module to start one."
        />
      </div>

      <h2 className="section-title">Event history</h2>
      <EventsView />
    </>
  );
}
