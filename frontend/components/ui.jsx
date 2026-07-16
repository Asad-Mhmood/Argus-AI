export function StatusBadge({ status }) {
  return (
    <span className={`badge ${status}`}>
      <span className="pip" /> {status}
    </span>
  );
}

export function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <div className="k">{label}</div>
      <div className="v">
        {value} {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

const ICON_PATHS = {
  face_attendance: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  ppe: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  anpr: (
    <>
      <path d="M5 11l1.3-3.9A2 2 0 0 1 8.2 6h7.6a2 2 0 0 1 1.9 1.1L19 11" />
      <rect x="3" y="11" width="18" height="6" rx="1.5" />
      <path d="M5 17v2M19 17v2" />
      <path d="M7 14h.01M17 14h.01" />
    </>
  ),
};

/** Small stroke icon for a use case; inherits color via currentColor. */
export function UseCaseIcon({ useCase, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[useCase]}
    </svg>
  );
}
