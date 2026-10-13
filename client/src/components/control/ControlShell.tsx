import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ChevronRight,
  Command,
  FileClock,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  Package,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import type { User } from "./api";
import { api, setCsrf } from "./api";
import ThemeColour from "./ThemeColour";

const sections = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/installer", label: "New installer", icon: Package },
  { href: "/commands", label: "Commands", icon: Command },
  { href: "/deployments", label: "Deployment history", icon: FileClock },
  { href: "/profiles", label: "Deployment profiles", icon: SlidersHorizontal },
  { href: "/operations", label: "Operations", icon: Activity },
  { href: "/users", label: "Users & invites", icon: Users },
  { href: "/account", label: "Account", icon: KeyRound },
];
export default function ControlShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setCsrf(null);
      navigate("/login");
    }
  }
  const initials = user.name
    .split(/\s+/)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="control-app">
      <aside className={`control-sidebar ${open ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-glyph">W</span>
          <span className="brand-copy">
            <strong>Win11Desk</strong>
            <small>CONTROL PLANE</small>
          </span>
          <button
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-context">
          <Shield size={14} />
          <span>Windows fleet</span>
          <span className="live-pip" />
        </div>
        <nav aria-label="Control plane navigation">
          {sections.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`side-link ${location === href || (href !== "/" && location.startsWith(href)) ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {location === href && (
                <ChevronRight size={14} className="side-current" />
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ThemeColour />
          <div className="user-card">
            <span className="avatar">{initials}</span>
            <span className="user-card-copy">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <button
              className="icon-button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
          <p className="sidebar-foot">
            Security and administrative changes are audited.
          </p>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-overlay"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="control-main">
        <header className="mobile-topbar">
          <button
            className="icon-button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <span className="mobile-wordmark">Win11Desk</span>
          <span className="mobile-role">{user.role}</span>
        </header>
        {children}
      </main>
    </div>
  );
}
