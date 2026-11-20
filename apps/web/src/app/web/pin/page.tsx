import { redirect } from "next/navigation";

import { PinForm } from "@/app/web/sign-in-forms";
import { SignInShell } from "@/app/web/sign-in-shell";
import { currentAgent } from "@/lib/agent-session";

export default async function AgentPinPage() {
  const agent = await currentAgent();

  if (!agent) redirect("/web/login");
  if (agent.session.otpPending) redirect("/web/otp");
  if (agent.session.access) redirect("/web");

  return (
    <SignInShell step="Last step" title="Enter your PIN" hint={`Signed in as ${agent.session.fullName}. The PIN unlocks your constituency's voters.`}>
      <PinForm />
    </SignInShell>
  );
}
