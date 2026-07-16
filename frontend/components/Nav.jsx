"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, apiUrl, isEngineOverridden, setEngineUrl } from "@/lib/api";

export default function Nav() {
  const pathname = usePathname();
  const [apiUp, setApiUp] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [overridden, setOverridden] = useState(false);

  useEffect(() => {
    setUrlInput(apiUrl());
    setOverridden(isEngineOverridden());
    let alive = true;
    const check = () =>
      api("/health").then(
        () => alive && setApiUp(true),
        () => alive && setApiUp(false),
      );
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  function saveEngine(e) {
    e.preventDefault();
    setEngineUrl(urlInput);
    window.location.reload();
  }

  function resetEngine() {
    setEngineUrl(null);
    window.location.reload();
  }

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/history", label: "History" },
  ];

  return (
    <nav className="nav">
      <Link href="/" className="brand">
        <span className="dot" aria-hidden />
        VisionGuard AI
      </Link>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`link ${pathname === l.href ? "active" : ""}`}
        >
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <span className="api-state">
        <span className={`pip ${apiUp === null ? "" : apiUp ? "ok" : "down"}`} />
        {apiUp === null ? "Connecting…" : apiUp ? "Engine online" : "Engine offline"}
      </span>
      <button
        type="button"
        className="btn sm"
        onClick={() => setShowSettings((s) => !s)}
        title="Engine connection settings"
      >
        ⚙ Engine{overridden ? " *" : ""}
      </button>

      {showSettings && (
        <form className="engine-panel" onSubmit={saveEngine}>
          <label className="field-label" htmlFor="engine-url">
            Engine URL
          </label>
          <input
            id="engine-url"
            className="input"
            placeholder="https://xxxx.trycloudflare.com"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            Paste your engine's public URL (e.g. from Cloudflare Tunnel). Saved in
            this browser only.
          </p>
          <div className="row">
            <button type="submit" className="btn sm primary">Save &amp; reload</button>
            {overridden && (
              <button type="button" className="btn sm" onClick={resetEngine}>
                Reset to default
              </button>
            )}
          </div>
        </form>
      )}
    </nav>
  );
}
