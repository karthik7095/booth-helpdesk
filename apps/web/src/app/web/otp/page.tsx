import { redirect } from "next/navigation";

import { OtpForm } from "@/app/web/sign-in-forms";
import { SignInShell } from "@/app/web/sign-in-shell";
import { currentAgent } from "@/lib/agent-session";

export default async function AgentOtpPage() {
  const agent = await currentAgent();

  if (!agent) redirect("/web/login");
  if (!agent.session.otpPending) redirect(agent.session.access ? "/web" : "/web/pin");

  return (
    <SignInShell
      step="Step 2 of 3"
      title="Enter the OTP"
      hint={`We sent a code to ${agent.session.mobileNumber.replace(/^(\d{2})\d{4}/, "$1••••")}.`}
    >
      <OtpForm />
    </SignInShell>
  );
}
