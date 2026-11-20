import { redirect } from "next/navigation";

import { LoginForm } from "@/app/web/sign-in-forms";
import { SignInShell } from "@/app/web/sign-in-shell";
import { currentAgent } from "@/lib/agent-session";

export default async function AgentLoginPage() {
  const agent = await currentAgent();

  if (agent?.session.access && !agent.session.otpPending) redirect("/web");

  return (
    <SignInShell step="Sign in" title="Booth Help Desk" hint="Enter your name and mobile number. We'll text you a code, then you'll enter the PIN your admin gave you.">
      <LoginForm />
    </SignInShell>
  );
}
