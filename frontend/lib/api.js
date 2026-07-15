export const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export async function api(path, options = {}) {
  const res = await fetch(`${API_URL}/api${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const USE_CASE_COLORS = {
  face_attendance: "var(--uc-face_attendance)",
  ppe: "var(--uc-ppe)",
  activity: "var(--uc-activity)",
  anpr: "var(--uc-anpr)",
};

export const USE_CASE_LABELS = {
  face_attendance: "Attendance",
  ppe: "PPE Safety",
  activity: "Activity",
  anpr: "ANPR",
};

export function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
