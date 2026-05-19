"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, LogOut, Settings, Trophy, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

type Props = {
  email: string;
  displayName: string;
  watchlistCount: number;
};

/**
 * Avatar button → dropdown with user info, "Manage stocks", and Sign out.
 * Replaces the standalone Manage-stocks link + Sign-out button — both are
 * now accessible at every breakpoint with one tap on the avatar.
 */
export function ProfileMenu({ email, displayName, watchlistCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initial = (displayName?.[0] ?? "?").toUpperCase();

  function signOut() {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring focus-visible:ring-offset-background flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label={`Account menu — ${displayName}`}
      >
        {initial}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 px-2 py-1.5">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {displayName !== email && (
              <p className="text-muted-foreground truncate text-xs font-normal">{email}</p>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/profile");
          }}
          className="cursor-pointer"
        >
          <User className="h-4 w-4" />
          <span>Profile &amp; badges</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/bets");
          }}
          className="cursor-pointer"
        >
          <History className="h-4 w-4" />
          <span>Your bets</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/leaderboard");
          }}
          className="cursor-pointer"
        >
          <Trophy className="h-4 w-4" />
          <span>Leaderboard</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/stocks");
          }}
          className="cursor-pointer"
        >
          <Settings className="h-4 w-4" />
          <span>Manage stocks</span>
          <span className="text-muted-foreground ml-auto text-xs">{watchlistCount}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            signOut();
          }}
          disabled={pending}
          className="text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          <span>{pending ? "Signing out…" : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
