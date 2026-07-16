const DEFAULT_API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const ENGINE_KEY = "vg_engine_url";

/** Engine base URL — a browser-saved override (Settings in the nav) beats the build-time env. */
export function apiUrl() {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(ENGINE_KEY);
    if (saved) return saved.replace(/\/$/, "");
  }
  return DEFAULT_API_URL;
}

export function setEngineUrl(url) {
  if (url && url.trim()) {
    window.localStorage.setItem(ENGINE_KEY, url.trim().replace(/\/$/, ""));
  } else {
    window.localStorage.removeItem(ENGINE_KEY);
  }
}

export function isEngineOverridden() {
  return typeof window !== "undefined" && !!window.localStorage.getItem(ENGINE_KEY);
}

export async function api(path, options = {}) {
  const res = await fetch(`${apiUrl()}/api${path}`, options);
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

/** Static module catalog — the home page and module workspaces render from this
 *  even when the engine is offline. Keys match the backend registry. */
export const USE_CASES = [
  {
    key: "face_attendance",
    title: "Face Attendance",
    description:
      "Recognize enrolled people on camera and keep an attendance log with arrival and last-seen times.",
  },
  {
    key: "ppe",
    title: "PPE Safety Compliance",
    description:
      "Detect missing helmets, vests and other safety-gear violations, and track the site compliance rate.",
  },
  {
    key: "activity",
    title: "Activity Monitoring",
    description:
      "Track people via pose keypoints and flag workers who stay idle beyond a set threshold.",
  },
  {
    key: "anpr",
    title: "License Plate Recognition",
    description:
      "Detect and read vehicle license plates, logging every unique plate with date and time.",
  },
];

export const USE_CASE_TITLES = Object.fromEntries(
  USE_CASES.map((u) => [u.key, u.title])
);

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
