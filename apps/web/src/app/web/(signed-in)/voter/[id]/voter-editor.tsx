"use client";

import { CASTE_CATEGORIES, DEFAULT_PARTY_OPTIONS, type Access, type Voter, type VoterPatch } from "@voter/shared";
import { useState, useTransition } from "react";

import { markVotedAction, saveVoterAction, type FormState } from "@/app/web/actions";
import { card, field, muted, Notice, primaryButton, secondaryButton } from "@/components/agent/ui";
import { cn } from "@/lib/utils";

type Form = {
  /** The English name as shown: the roll's first and last name columns together. */
  name: string;
  mobileNo1: string;
  age: string;
  houseNo: string;
  eVillage: string;
  religion: string;
  community: string | null;
  subCategory: string | null;
  caste: string;
  partyLoyalty: string | null;
};

const formFrom = (voter: Voter): Form => ({
  name: [voter.eFirstName, voter.eLastName].map((part) => (part ?? "").trim()).filter(Boolean).join(" "),
  mobileNo1: voter.mobileNo1 ?? "",
  age: voter.age == null ? "" : String(voter.age),
  houseNo: voter.houseNo ?? "",
  eVillage: voter.eVillage ?? "",
  religion: voter.religion ?? "",
  community: voter.community,
  subCategory: voter.subCategory,
  caste: voter.caste ?? "",
  partyLoyalty: voter.partyLoyalty,
});

/** Only what differs from the saved voter, as the phone app sends it. */
function changesBetween(saved: Form, next: Form): VoterPatch {
  const patch: VoterPatch = {};
  const text = (value: string) => value.trim() || null;
  // A corrected name goes as a whole; the server keeps the roll's spelling beside it.
  const name = next.name.trim().replace(/\s+/g, " ");
  if (name && name !== saved.name.trim().replace(/\s+/g, " ")) patch.eFirstName = name;

  for (const key of ["mobileNo1", "houseNo", "eVillage", "religion"] as const) {
    if (text(next[key]) !== text(saved[key])) patch[key] = text(next[key]);
  }
  if (next.age.trim() !== saved.age.trim()) patch.age = next.age.trim() ? Number(next.age.trim()) : null;
  if (next.community !== saved.community) patch.community = next.community;
  if (next.subCategory !== saved.subCategory) patch.subCategory = next.subCategory;
  if (text(next.caste) !== text(saved.caste)) patch.caste = text(next.caste);
  if (next.partyLoyalty !== saved.partyLoyalty) patch.partyLoyalty = next.partyLoyalty;

  return patch;
}

const chip = (selected: boolean) =>
  cn(
    "flex min-h-11 items-center justify-center rounded-xl border-2 px-3 text-sm font-semibold",
    selected ? "border-[#0C4EF0] bg-[#E6EEFF] text-[#0C4EF0]" : "border-[#DBE3F3] bg-white",
  );

export function VoterEditor({ voter, access }: { voter: Voter; access: Access }) {
  const [form, setForm] = useState(() => formFrom(voter));
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();

  const saved = formFrom(voter);
  const patch = changesBetween(saved, form);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const category = CASTE_CATEGORIES.find((option) => option.value === form.community);
  const partyOptions: string[] = access.partyOptions?.length ? access.partyOptions : [...DEFAULT_PARTY_OPTIONS];
  // A choice the admin has since removed stays visible rather than silently unselected.
  const partyChoices = form.partyLoyalty && !partyOptions.includes(form.partyLoyalty) ? [...partyOptions, form.partyLoyalty] : partyOptions;

  const save = () => {
    if (patch.age !== undefined && patch.age !== null && (!Number.isInteger(patch.age) || patch.age < 18 || patch.age > 120)) {
      setState({ error: "Age must be a whole number between 18 and 120." });
      return;
    }
    start(async () => setState(await saveVoterAction(voter.id, patch)));
  };

  const toggleVoted = () => start(async () => setState(await markVotedAction(voter.id, !voter.hasVoted)));

  const text = (key: "mobileNo1" | "houseNo" | "eVillage" | "religion" | "caste", label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input value={form[key]} onChange={(event) => set(key, event.target.value)} className={field} {...props} />
    </label>
  );

  return (
    <section className={`${card} grid gap-4 p-4`} aria-labelledby="edit-heading">
      <h2 id="edit-heading" className="text-base font-bold">
        Update details
      </h2>

      {access.enableVoteStatus ? (
        <button type="button" onClick={toggleVoted} disabled={pending} className={voter.hasVoted ? secondaryButton : primaryButton}>
          {voter.hasVoted ? "Mark as not voted" : "Mark as voted"}
        </button>
      ) : null}

      <label className="grid gap-2 text-sm font-semibold">
        Voter name (English)
        <input
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={120}
          className={cn(field, "uppercase", patch.eFirstName !== undefined && "border-[#FE900A]")}
        />
        <span className={`text-xs font-normal ${muted}`}>Fix a misspelt name; the roll&rsquo;s spelling is kept on the server.</span>
      </label>

      {text("mobileNo1", "Mobile", { type: "tel", inputMode: "numeric", autoComplete: "off", maxLength: 20 })}
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-2 text-sm font-semibold">
          Age
          <input value={form.age} onChange={(event) => set("age", event.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={3} className={field} />
        </label>
        {text("houseNo", "House no.", { maxLength: 120 })}
      </div>
      {text("eVillage", "Village / area", { maxLength: 120 })}
      {text("religion", "Religion", { maxLength: 60 })}

      {access.enableCasteEntry ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-semibold">Category</legend>
          <div className="grid grid-cols-3 gap-2">
            {CASTE_CATEGORIES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={form.community === option.value}
                onClick={() => {
                  const same = form.community === option.value;
                  setForm((prev) => ({ ...prev, community: same ? null : option.value, subCategory: null }));
                }}
                className={chip(form.community === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {category?.subCategories.length ? (
            <div className="grid grid-cols-5 gap-2" role="group" aria-label="Sub-category">
              {category.subCategories.map((sub) => (
                <button key={sub} type="button" aria-pressed={form.subCategory === sub} onClick={() => set("subCategory", form.subCategory === sub ? null : sub)} className={chip(form.subCategory === sub)}>
                  {sub}
                </button>
              ))}
            </div>
          ) : null}
          {text("caste", category?.casteLabel ?? "Caste / Community", { maxLength: 80 })}
        </fieldset>
      ) : null}

      {access.enablePartyLoyalty ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Party</legend>
          <div className="grid grid-cols-3 gap-2">
            {partyChoices.map((party) => (
              <button key={party} type="button" aria-pressed={form.partyLoyalty === party} onClick={() => set("partyLoyalty", form.partyLoyalty === party ? null : party)} className={chip(form.partyLoyalty === party)}>
                {party}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message && !dirty ? <Notice tone="ok">{state.message}</Notice> : null}

      <button type="button" onClick={save} disabled={!dirty || pending} className={primaryButton}>
        {pending ? "Saving…" : "Save changes"}
      </button>
      <p className={`text-xs ${muted}`}>Changes reach every phone on its next sync.</p>
    </section>
  );
}
