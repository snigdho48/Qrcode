import { NavLink, Outlet } from "react-router-dom"

import { Button } from "@workspace/ui/components/button"

import { useAuth } from "@/context/auth-context"
import { cn } from "@workspace/ui/lib/utils"

const navCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    "block cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
  )

export function AppShell() {
  const { logout, username } = useAuth()
  return (
    <div className="bg-background text-foreground min-h-svh w-full min-w-0">
      <aside
        className="border-border bg-sidebar text-sidebar-foreground fixed inset-y-0 start-0 z-40 flex w-56 flex-col border-e"
        aria-label="Main navigation"
      >
        <div className="border-sidebar-border border-b px-4 py-4">
          <p className="text-sidebar-foreground/60 text-xs tracking-wide uppercase">QR Studio</p>
          <p className="mt-1 truncate text-sm font-medium">{username}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <NavLink to="/qr-codes" className={navCls}>
            QR codes
          </NavLink>
          <NavLink to="/report" className={navCls}>
            Report
          </NavLink>
        </nav>
        <div className="border-sidebar-border border-t p-3">
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </aside>

      <div className="min-h-svh min-w-0 ps-56">
        <main className="box-border w-full min-w-0 max-w-full px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
