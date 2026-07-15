"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Nav() {
  const pathname = usePathname();
  const [apiUp, setApiUp] = useState(null);

  useEffect(() => {
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
    </nav>
  );
}
