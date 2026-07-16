"use client";
import Link from "next/link";
import { fmtDateTime, USE_CASE_COLORS, USE_CASE_LABELS } from "@/lib/api";
import { StatusBadge } from "@/components/ui";

/**
 * Sessions table used on the module workspaces and the status page.
 * Hide the use-case column with showUseCase={false} when the list is
 * already scoped to a single module.
 */
export default function SessionTable({ title, rows, empty, showUseCase = true }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {showUseCase && <th>Use case</th>}
                <th>Source</th>
                <th>Started</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  {showUseCase && (
                    <td>
                      <Link href={`/session/${s.id}`}>
                        <span className="chip" style={{ background: USE_CASE_COLORS[s.use_case] }} />
                        {USE_CASE_LABELS[s.use_case] || s.use_case}
                      </Link>
                    </td>
                  )}
                  <td className="muted">{s.source_type === "rtsp" ? "live camera" : s.source_type}</td>
                  <td className="num">{fmtDateTime(s.started_at || s.created_at)}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/session/${s.id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                      view →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
