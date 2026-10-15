import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  Command,
  FileClock,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  Package,
  Search,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import type { User } from "./api";
import { api, setCsrf } from "./api";
import ThemeColour from "./ThemeColour";
import { SpotlightNavbar } from "../vengeance/spotlight-navbar";
import {
  Command as CommandMenu,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

export const workspaceLinks = [
  {
    href: "/",
    label: "Overview",
    icon: Gauge,
    group: "Workspace",
    description: "Fleet signals and recent deployments",
  },
  {
    href: "/installer",
    label: "New installer",
    icon: Package,
    group: "Deploy",
    description: "Configure Windows and create an installation",
  },
  {
    href: "/remote-jobs",
    label: "Remote installations",
    icon: TerminalSquare,
    group: "Deploy",
    description: "SSH preflight, reviews and remote jobs",
  },
  {
    href: "/commands",
    label: "Commands",
    icon: Command,
    group: "Deploy",
    description: "Issued commands, delivery and expiry",
  },
  {
    href: "/deployments",
    label: "Deployment history",
    icon: FileClock,
    group: "Deploy",
    description: "Installation progress and credentials",
  },
  {
    href: "/profiles",
    label: "Deployment profiles",
    icon: SlidersHorizontal,
    group: "Manage",
    description: "Operating systems, media and revisions",
  },
  {
    href: "/operations",
    label: "Operations",
    icon: Activity,
    group: "Manage",
    description: "Health, storage, recovery and maintenance",
  },
  {
    href: "/users",
    label: "Users & invites",
    icon: Users,
    group: "Security",
    description: "Workspace membership and access",
  },
  {
    href: "/account",
    label: "Account",
    icon: KeyRound,
    group: "Security",
    description: "Password, MFA, sessions and appearance",
  },
];
export function DeskMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`desk-mark ${small ? "desk-mark-small" : ""}`}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
export default function ControlShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [location, navigate] = useLocation();
  const links = workspaceLinks.filter(
    item =>
      item.href !== "/remote-jobs" || ["owner", "admin"].includes(user.role)
  );
  const active =
    links.find(
      item =>
        location === item.href ||
        (item.href !== "/" && location.startsWith(item.href))
    ) || links[0];
  const category = location.startsWith("/operations")
    ? 2
    : ["/profiles", "/users", "/account"].some(path =>
          location.startsWith(path)
        )
      ? 1
      : 0;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(value => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [location]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    const close = sidebar?.querySelector<HTMLButtonElement>(".sidebar-close");
    close?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sidebar) return;
      const controls = [
        ...sidebar.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled),select"
        ),
      ].filter(el => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", trap);
      previousFocus?.focus();
    };
  }, [open]);
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
  const go = (href: string) => {
    setSearchOpen(false);
    setOpen(false);
    navigate(href);
  };
  return (
    <div className="control-app vengeance-workspace">
      <a href="#workspace-content" className="skip-link">
        Skip to main content
      </a>
      <aside
        ref={sidebarRef}
        className={`control-sidebar ${open ? "is-open" : ""}`}
        aria-label="Workspace sidebar"
      >
        <Link href="/" className="sidebar-brand" onClick={() => setOpen(false)}>
          <DeskMark />
          <span className="brand-copy">
            <strong>
              Win11Desk<span className="brand-period">.</span>
            </strong>
            <small>DEPLOYMENT CONTROL</small>
          </span>
        </Link>
        <button
          className="sidebar-close icon-button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
        <div className="sidebar-context">
          <span className="workspace-symbol">W</span>
          <span>
            <strong>Windows installer</strong>
            <small>Private workspace</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Find a page</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav aria-label="Dashboard navigation">
          {["Workspace", "Deploy", "Manage", "Security"].map(group => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {links
                .filter(link => link.group === group)
                .map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`side-link ${active.href === href ? "active" : ""}`}
                    aria-current={active.href === href ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                    {active.href === href && <span className="active-line" />}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-security">
            <Shield size={16} />
            <div>
              <strong>Your control. Your servers.</strong>
              <p>Administrative changes are audited.</p>
            </div>
          </div>
          <div className="sidebar-appearance">
            <ThemeColour />
          </div>
          <div className="user-card">
            <Link href="/account" className="user-identity">
              <span className="avatar">{initials}</span>
              <span className="user-card-copy">
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </span>
            </Link>
            <button
              className="icon-button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-overlay"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main
        className="control-main"
        id="workspace-content"
        tabIndex={-1}
        inert={open || undefined}
      >
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <button
              className="icon-button mobile-menu-toggle"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <span>{active.label}</span>
          </div>
          <SpotlightNavbar
            key={category}
            className="workspace-spotlight"
            items={[
              { label: "Deploy", href: "/" },
              { label: "Manage", href: "/profiles" },
              { label: "Operate", href: "/operations" },
            ]}
            defaultActiveIndex={category}
            onItemClick={item => navigate(item.href)}
          />
          <div className="topbar-actions">
            <span className="private-chip">
              <Shield size={12} /> {user.role}
            </span>
            <button
              className="icon-button topbar-search"
              aria-label="Search pages"
              title="Search pages (Ctrl/⌘ K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
            </button>
            <Link
              href="/installer"
              className="topbar-deploy"
              aria-label="Open new installer"
            >
              Deploy <ArrowUpRight size={15} />
            </Link>
          </div>
        </header>
        {children}
        <footer className="workspace-footer">
          <span>
            <DeskMark small /> Win11Desk dashboard
          </span>
          <span>Profiles → configure → deploy → track</span>
        </footer>
      </main>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent
          className="workspace-command-dialog"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Find a page</DialogTitle>
          <DialogDescription className="sr-only">
            Search navigation destinations. Use arrow keys and Enter to
            navigate. Escape closes search.
          </DialogDescription>
          <CommandMenu>
            <CommandInput
              placeholder="Where do you want to go?"
              aria-label="Search pages"
            />
            <CommandList>
              <CommandEmpty>No pages match this search.</CommandEmpty>
              {["Workspace", "Deploy", "Manage", "Security"].map(group => (
                <CommandGroup key={group} heading={group}>
                  {links
                    .filter(link => link.group === group)
                    .map(item => (
                      <CommandItem
                        key={item.href}
                        value={`${item.label} ${item.description}`}
                        onSelect={() => go(item.href)}
                      >
                        <item.icon size={18} />
                        <span className="command-item-copy">
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                        <CommandShortcut>
                          <ArrowUpRight size={14} />
                        </CommandShortcut>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="command-search-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> Navigate <kbd>↵</kbd> Open
              </span>
              <button
                className="text-button"
                onClick={() => setSearchOpen(false)}
              >
                Esc · Close
              </button>
            </div>
          </CommandMenu>
        </DialogContent>
      </Dialog>
    </div>
  );
}
