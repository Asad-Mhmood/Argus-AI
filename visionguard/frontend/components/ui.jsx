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
