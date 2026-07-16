"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, USE_CASES, USE_CASE_COLORS } from "@/lib/api";
import { UseCaseIcon } from "@/components/ui";
import StartAnalysis from "@/components/StartAnalysis";
import SessionTable from "@/components/SessionTable";
import EventsView from "@/components/EventsView";
import AttendanceView from "@/components/AttendanceView";
import PeopleView from "@/components/PeopleView";

export default function ModulePage() {
  // useSearchParams (inside the workspace) requires a Suspense boundary
  return (
    <Suspense fallback={null}>
      <ModuleWorkspace />
    </Suspense>
  );
}

function ModuleWorkspace() {
  const { key } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const uc = USE_CASES.find((u) => u.key === key);

  const tabs = [
    ["monitor", "Monitor"],
    ...(key === "face_attendance"
      ? [["attendance", "Attendance"], ["people", "People"]]
      : []),
    ["events", "Event history"],
  ];
  const tabParam = searchParams.get("tab");
  const tab = tabs.some(([k]) => k === tabParam) ? tabParam : "monitor";

  const [sessions, setSessions] = useState({ live: [], history: [] });

  useEffect(() => {
    if (!uc) return;
    let alive = true;
    const refresh = () =>
      api("/sessions")
        .then((all) => {
          if (!alive) return;
          setSessions({
            live: (all.live || []).filter((s) => s.use_case === key),
            history: (all.history || []).filter((s) => s.use_case === key),
          });
        })
        .catch(() => {});
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [key, uc]);

  if (!uc) {
    return (
      <>
        <h1 className="page-title">Module not found</h1>
        <p className="page-sub">There is no module named “{key}”.</p>
        <Link className="btn" href="/">← Back to modules</Link>
      </>
    );
  }

  function setTab(k) {
    router.replace(`/module/${key}${k === "monitor" ? "" : `?tab=${k}`}`, { scroll: false });
  }

  return (
    <>
      <Link href="/" className="backlink">← All modules</Link>

      <div className="module-head" style={{ "--mc": USE_CASE_COLORS[key] }}>
        <div className="icon"><UseCaseIcon useCase={key} size={26} /></div>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{uc.title}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{uc.description}</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tab ${tab === k ? "active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "monitor" && (
        <>
          <div style={{ marginBottom: 14 }}>
            <StartAnalysis useCase={key} />
          </div>
          <div className="grid cols-2">
            <SessionTable
              title="Running now"
              rows={sessions.live}
              empty="No active sessions."
              showUseCase={false}
            />
            <SessionTable
              title="Recent sessions"
              rows={sessions.history.slice(0, 8)}
              empty="Nothing yet — start your first analysis above."
              showUseCase={false}
            />
          </div>
        </>
      )}

      {tab === "attendance" && <AttendanceView />}
      {tab === "people" && <PeopleView />}
      {tab === "events" && <EventsView useCase={key} />}
    </>
  );
}
