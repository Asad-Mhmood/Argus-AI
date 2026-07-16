"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, USE_CASES, USE_CASE_COLORS } from "@/lib/api";
import { UseCaseIcon } from "@/components/ui";

export default function Home() {
  const [engineUp, setEngineUp] = useState(null);
  const [liveSessions, setLiveSessions] = useState([]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      api("/health").then(
        () => alive && setEngineUp(true),
        () => alive && setEngineUp(false),
      );
      api("/sessions")
        .then((s) => alive && setLiveSessions(s.live || []))
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const runningBy = {};
  for (const s of liveSessions) {
    runningBy[s.use_case] = (runningBy[s.use_case] || 0) + 1;
  }

  return (
    <>
      <section className="hero">
        <div className="eyebrow">AI video intelligence platform</div>
        <h1>What would you like to monitor?</h1>
        <p>
          Pick a module to analyse a live camera or an uploaded recording.
          Every detection is logged, searchable, and exportable.
        </p>
      </section>

      <div className="grid cols-2 module-grid">
        {USE_CASES.map((uc) => {
          const running = runningBy[uc.key] || 0;
          return (
            <Link
              key={uc.key}
              href={`/module/${uc.key}`}
              className="module-card"
              style={{ "--mc": USE_CASE_COLORS[uc.key] }}
            >
              <div className="icon">
                <UseCaseIcon useCase={uc.key} />
              </div>
              <div className="t">{uc.title}</div>
              <div className="d">{uc.description}</div>
              <div className="foot">
                {running > 0 ? (
                  <span className="badge running">
                    <span className="pip" /> {running} live session{running > 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="muted">No active sessions</span>
                )}
                <span className="open">Open →</span>
              </div>
            </Link>
          );
        })}
      </div>

      <Link href="/status" className="status-strip">
        <span className={`pip ${engineUp === null ? "" : engineUp ? "ok" : "down"}`} />
        <span>
          {engineUp === null
            ? "Connecting to engine…"
            : engineUp
              ? "Engine online"
              : "Engine offline — check the ⚙ Engine settings"}
        </span>
        <span className="sep" aria-hidden>·</span>
        <span>
          {liveSessions.length > 0
            ? `${liveSessions.length} session${liveSessions.length > 1 ? "s" : ""} running now`
            : "No sessions running"}
        </span>
        <span className="spacer" />
        <span className="open">View system status →</span>
      </Link>
    </>
  );
}
