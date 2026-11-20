"use client";

import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";

import { loginAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

const fieldClass =
  "h-13 rounded-xl border-slate-200 bg-white pl-11 text-base text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:border-[#0C4EF0] focus-visible:ring-[#0C4EF0]/20 md:text-base";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-[520px] rounded-[28px] bg-white p-7 shadow-[0_30px_80px_-30px_rgba(4,29,122,0.35),0_2px_6px_rgba(4,29,122,0.06)] ring-1 ring-[#DBE3F3] sm:p-12">
      <div className="grid size-20 place-items-center rounded-full bg-[#E6EEFF] text-[#0C4EF0]">
        <ShieldCheck className="size-9" strokeWidth={1.8} />
      </div>

      <h2 className="mt-8 text-[28px] leading-tight font-semibold tracking-tight text-[#041D7A]">
        Admin sign in
      </h2>
      <p className="mt-2 text-base text-slate-500">Manage constituencies and issue access PINs.</p>

      <form action={action} className="mt-8 grid gap-6">
        <div className="grid gap-2.5">
          <Label htmlFor="email" className="text-base text-slate-900">
            Email
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-400" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="admin@voter.local"
              required
              className={fieldClass}
            />
          </div>
        </div>

        <div className="grid gap-2.5">
          <Label htmlFor="password" className="text-base text-slate-900">
            Password
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-400" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className={`${fieldClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-3 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[#0C4EF0]/40 focus-visible:outline-none"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {state.error ? (
          <p className="text-destructive text-sm" role="alert">
            {state.error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={pending}
          className="h-14 w-full rounded-xl bg-[#0C4EF0] text-lg font-semibold text-white shadow-[0_12px_24px_-10px_rgba(12,78,240,0.7)] hover:bg-[#0A42CC] focus-visible:ring-[#0C4EF0]/40"
        >
          {pending ? "Signing in…" : "Sign in"}
          <ArrowRight className="size-5" strokeWidth={2.4} />
        </Button>
      </form>
    </div>
  );
}
