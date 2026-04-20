import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Activity,
  Settings,
  TrendingUp,
  Users,
  Menu,
  X,
  ChevronRight,
  Radar,
  Target,
  Zap,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Production", icon: Activity, description: "Daily sales, CR, and gate status" },
  { path: "/coaching", label: "Coaching Map", icon: Target, description: "Skill x effort quadrant + momentum" },
  { path: "/pipeline", label: "Pipeline", icon: Radar, description: "Health scores and coaching actions" },
  { path: "/leads-pool", label: "Leads Pool", icon: Users, description: "Pool activity and self-assigns" },
  { path: "/activity", label: "Activity Profiles", icon: Zap, description: "Tenure-cohort baselines + anomalies" },
  { path: "/trends", label: "Trends", icon: TrendingUp, description: "Agent analytics and stack rank" },
  { path: "/settings", label: "Settings", icon: Settings, description: "Roster, aliases, and data import" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-blue-600 flex items-center justify-center">
              <span className="text-white font-mono text-xs font-bold">DSB</span>
            </div>
            <div>
              <span className="text-sm font-bold text-sidebar-foreground block leading-none">Tier Calculator</span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Command Center</span>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors group",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-blue-400")} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">{item.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate block">
                      {item.description}
                    </span>
                  </div>
                  {isActive && <ChevronRight className="h-3 w-3 text-blue-400 shrink-0" />}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="text-[10px] font-mono text-muted-foreground space-y-1">
            <div>Buckets: T1=19 | T2=47 | T3=22</div>
            <div>Max Swaps: 5 per window</div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              {navItems.find((n) => n.path === location)?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">
              Digital Senior Benefits
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
