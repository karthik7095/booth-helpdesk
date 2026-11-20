"use client";

import { ArrowRight } from "lucide-react";
import { useActionState } from "react";

import {
  agentLoginAction,
  agentOtpAction,
  agentPinAction,
  agentResendOtpAction,
  type FormState,
} from "@/app/web/actions";
import { field, Notice, primaryButton } from "@/components/agent/ui";

const initial: FormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(agentLoginAction, initial);

  return (
    <form action={action} className="grid gap-5">
      <label className="grid gap-2 text-sm font-semibold">
        Full name
        <input name="fullName" autoComplete="name" required minLength={2} placeholder="Your name" className={field} />
      </label>
      <label className="grid gap-2 text-sm font-semibold">
        Mobile number
        <input
          name="mobileNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required
          pattern="[0-9 +]{10,14}"
          placeholder="10-digit mobile"
          className={field}
        />
      </label>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Signing in…" : "Continue"}
        <ArrowRight className="size-5" />
      </button>
    </form>
  );
}

export function OtpForm() {
  const [state, action, pending] = useActionState(agentOtpAction, initial);
  const [resent, resend, resending] = useActionState(agentResendOtpAction, initial);

  return (
    <div className="grid gap-5">
      <form action={action} className="grid gap-5">
        <label className="grid gap-2 text-sm font-semibold">
          OTP
          <input
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={8}
            placeholder="Code from the SMS"
            className={`${field} text-center text-xl tracking-[0.4em]`}
          />
        </label>
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Checking…" : "Verify"}
        </button>
      </form>
      <form action={resend} className="text-center">
        {resent.error ? <Notice tone="error">{resent.error}</Notice> : null}
        {resent.message ? <Notice tone="ok">{resent.message}</Notice> : null}
        <button type="submit" disabled={resending} className="mt-2 min-h-11 text-sm font-semibold text-[#0C4EF0]">
          {resending ? "Sending…" : "Didn't get it? Send the code again"}
        </button>
      </form>
    </div>
  );
}

export function PinForm() {
  const [state, action, pending] = useActionState(agentPinAction, initial);

  return (
    <form action={action} className="grid gap-5">
      <label className="grid gap-2 text-sm font-semibold">
        Access PIN
        <input
          name="pin"
          required
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="PIN from your admin"
          className={`${field} text-center text-xl uppercase tracking-widest`}
        />
      </label>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
