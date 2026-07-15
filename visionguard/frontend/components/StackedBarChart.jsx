"use client";
import { useMemo, useRef, useState } from "react";
import { USE_CASE_COLORS, USE_CASE_LABELS } from "@/lib/api";

/**
 * Events-per-hour stacked bar chart (custom SVG, no library).
 * data: [{bucket: epochSeconds, use_case, count}]
 */
export default function StackedBarChart({ data, hours }) {
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null); // {x, y, bucket, rows}

  const { buckets, series, maxTotal } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const start = now - (hours - 1) * 3600;
    const byBucket = new Map();
    for (let t = start; t <= now; t += 3600) byBucket.set(t, {});
    const present = new Set();
    for (const row of data) {
      if (!byBucket.has(row.bucket)) continue;
      byBucket.get(row.bucket)[row.use_case] = row.count;
      present.add(row.use_case);
    }
    // fixed slot order — color follows the entity, never the filter
    const order = ["face_attendance", "ppe", "activity", "anpr"].filter((k) => present.has(k));
    const buckets = [...byBucket.entries()].map(([t, counts]) => ({
      t,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    }));
    return { buckets, series: order, maxTotal: Math.max(1, ...buckets.map((b) => b.total)) };
  }, [data, hours]);

  const W = 900, H = 260;
  const M = { top: 12, right: 8, bottom: 26, left: 40 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const n = buckets.length;
  const step = iw / n;
  const barW = Math.min(28, Math.max(3, step - 4));
  const yTicks = niceTicks(maxTotal);
  const yMax = yTicks[yTicks.length - 1];
  const y = (v) => ih - (v / yMax) * ih;

  const labelEvery = Math.ceil(n / 8);

  function showTip(evt, b) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: evt.clientX - rect.left + 12,
      y: evt.clientY - rect.top - 10,
      bucket: b.t,
      rows: series.map((k) => [k, b.counts[k] || 0]).filter(([, v]) => v > 0),
      total: b.total,
    });
  }

  const hasData = buckets.some((b) => b.total > 0);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {!hasData ? (
        <p className="empty">No events in this period.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
               aria-label="Events per hour by use case">
            {/* recessive hairline grid */}
            {yTicks.map((v) => (
              <g key={v} transform={`translate(0,${M.top + y(v)})`}>
                <line x1={M.left} x2={W - M.right} stroke="var(--grid)" strokeWidth="1" />
                <text x={M.left - 8} y="4" textAnchor="end" fontSize="11" fill="var(--muted)"
                      fontVariant="tabular-nums">{v}</text>
              </g>
            ))}
            {/* baseline */}
            <line x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih}
                  stroke="var(--baseline)" strokeWidth="1" />
            {/* bars */}
            {buckets.map((b, i) => {
              const cx = M.left + i * step + step / 2;
              let acc = 0;
              const segs = series
                .map((k) => {
                  const v = b.counts[k] || 0;
                  const seg = { k, v, y0: acc, y1: acc + v };
                  acc += v;
                  return seg;
                })
                .filter((s) => s.v > 0);
              return (
                <g key={b.t}>
                  {segs.map((s, si) => {
                    const top = M.top + y(s.y1);
                    const height = Math.max(1, y(s.y0) - y(s.y1) - (si < segs.length - 1 ? 2 : 0));
                    const isTop = si === segs.length - 1;
                    return (
                      <rect
                        key={s.k}
                        x={cx - barW / 2}
                        y={top}
                        width={barW}
                        height={height}
                        fill={USE_CASE_COLORS[s.k]}
                        rx={isTop ? 4 : 0}
                      />
                    );
                  })}
                  {/* hover hit target wider than the mark */}
                  <rect
                    x={M.left + i * step} y={M.top} width={step} height={ih}
                    fill="transparent"
                    onMouseMove={(e) => b.total > 0 && showTip(e, b)}
                    onMouseLeave={() => setTip(null)}
                  />
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                      {hourLabel(b.t, hours)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="legend">
            {series.map((k) => (
              <span key={k} className="item">
                <span className="chip" style={{ background: USE_CASE_COLORS[k], marginRight: 0 }} />
                {USE_CASE_LABELS[k] || k}
              </span>
            ))}
          </div>
          {tip && (
            <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
              <strong>{hourLabel(tip.bucket, hours)}</strong> · {tip.total} events
              {tip.rows.map(([k, v]) => (
                <div key={k}>
                  <span className="chip" style={{ background: USE_CASE_COLORS[k] }} />
                  {USE_CASE_LABELS[k] || k}: <strong>{v}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function hourLabel(ts, hours) {
  const d = new Date(ts * 1000);
  return hours > 48
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function niceTicks(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}
