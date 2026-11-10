"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, FileText, Library, LogOut, MessageSquarePlus, Monitor, Moon, PanelLeftClose, Settings, Shield, Sun } from "lucide-react";
import { Avatar, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@open-resume/ui";
import { useEffect, useRef } from "react";
import { LogoMark } from "@/components/common/wordmark";
import { useAuth } from "@/lib/auth";
import { useProductName } from "@/lib/meta";
import { useUsage } from "@/lib/queries";
import { useTheme } from "@/lib/stores/theme";

/** The app's sections. */
export const APP_NAV = [
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/builder", label: "Builder", icon: MessageSquarePlus },
  { href: "/samples", label: "Samples", icon: Library },
] as const;

/** A section is current for its own path and anything below it. */
export function isCurrentSection(pathname: string | null, href: string): boolean {
  return !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
}

function UsageLine() {
  const { data } = useUsage();
  if (!data?.runs.limit) return null;
  const pct = Math.min(100, Math.round((data.runs.used / data.runs.limit) * 100));
  return (
    <div className="px-3 pb-2" title={`${data.runs.used} of ${data.runs.limit} AI runs this month`}>
      <div className="flex justify-between text-[12px] text-subtle-foreground">
        <span>AI runs this month</span>
        <span className="tabular-nums">
          {data.runs.used} / {data.runs.limit}
        </span>
      </div>
      <div className="mt-1 h-[3px] rounded-full bg-border">
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Sidebar({ onCollapse, onNavigate }: { onCollapse?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const name = useProductName();
  const { user, isAdmin, logout } = useAuth();
  const { pref, setPref } = useTheme();

  // Close the phone sheet after navigating, but not when it first opens (mount).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    onNavigate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-ground-2/60">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href="/" className="flex min-w-0 items-center gap-2 rounded-md" aria-label={`${name} home`}>
          <LogoMark className="size-7" />
          <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">{name}</span>
        </Link>
        {onCollapse ? (
          <Tooltip content="Close sidebar">
            <button type="button" onClick={onCollapse} aria-label="Close sidebar" className="inline-flex size-8 items-center justify-center rounded-lg text-subtle-foreground hover:bg-muted hover:text-foreground">
              <PanelLeftClose className="size-[18px]" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pt-1">
        {APP_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrentSection(pathname, item.href) ? "page" : undefined}
            data-testid={`nav-${item.label.toLowerCase()}`}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium hover:bg-muted", isCurrentSection(pathname, item.href) && "bg-muted")}
          >
            <item.icon className="size-[18px]" /> {item.label}
          </Link>
        ))}
      </div>

      <div className="border-t border-border pt-2">
        <UsageLine />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="account-menu" className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted">
              <Avatar name={user?.displayName ?? "?"} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{user?.displayName}</span>
                <span className="block truncate text-[12px] text-subtle-foreground">{user?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <Settings className="size-4" /> Settings
            </DropdownMenuItem>
            {isAdmin ? (
              <DropdownMenuItem onSelect={() => router.push("/admin")}>
                <Shield className="size-4" /> Admin
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Theme</DropdownMenuLabel>
            {(
              [
                ["system", "System", Monitor],
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([v, label, Icon]) => (
              <DropdownMenuItem key={v} onSelect={(e) => (e.preventDefault(), setPref(v))}>
                <Icon className="size-4" /> {label}
                {pref === v ? <Check className="ml-auto size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="sign-out" onSelect={() => void logout()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

