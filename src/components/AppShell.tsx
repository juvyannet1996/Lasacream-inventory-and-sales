"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconDashboard },
  { href: "/sales", label: "Sales", icon: IconSales },
  { href: "/inventory", label: "Inventory", icon: IconInventory },
  { href: "/products", label: "Products", icon: IconProducts },
  { href: "/history", label: "History", icon: IconHistory },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Lasacream</div>
        <nav aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "nav-link is-active" : "nav-link"}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong>Lasacream</strong>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function IconSales() {
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M7 7h10l1 13H6L7 7Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconInventory() {
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 8 7 4h10l3 4M12 12v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function IconProducts() {
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M4 14c2-4 5-6 8-6s6 2 8 6c-2 3-5 5-8 5s-6-2-8-5Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8V5M9 6c1 .8 2 .8 3 0M12 6c1 .8 2 .8 3 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
