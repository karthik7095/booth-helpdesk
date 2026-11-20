import type { Access } from "@voter/shared";
import { Asset } from "expo-asset";
import * as Print from "expo-print";
import { Alert, Linking } from "react-native";

import { recordSlipPrints, type LocalVoter } from "@/lib/db";
import type { NameLanguage } from "@/lib/language";
import { loadAccess } from "@/lib/auth";
import { printableSlipCoverUri } from "@/lib/my-slip-covers";
import { cachedWardBannerUri } from "@/lib/ward-banners";
import { currentFix } from "@/lib/usage-tracker";
import { shareCoverAfterGreeting, shareCoverWithText } from "@/lib/whatsapp";

import {
  connectedPrinter,
  isCutNoteEnabled,
  isImagePrintEnabled,
  printReceipt,
  BOLD_COLUMNS,
  PRINTER_COLUMNS,
  type ReceiptBlock,
  type ReceiptSize,
} from "@/lib/printer";

/** Rolls store bare 10-digit numbers; WhatsApp and tel: want the country code. */
const COUNTRY_CODE = "91";

/**
 * The name in the requested script, falling back to the other one. A roll is
 * routinely missing one spelling for a given voter — usually the native one on
 * rows added in the field — and a blank name in a list helps nobody. The
 * middle-name column holds the relative's name, so it stays out of this one —
 * see `voterRelativeName`.
 */
export function voterFullName(voter: LocalVoter, language: NameLanguage = "english"): string {
  const join = (first: string | null, last: string | null) =>
    [first, last].map((part) => (part ?? "").trim()).filter(Boolean).join(" ");

  const native = join(voter.lFirstName, voter.lLastName);
  const english = join(voter.eFirstName, voter.eLastName);

  // A name an agent corrected is English only; the roll's local spelling is still the misspelt one.
  if (language === "native" && !voter.eFirstNameRoll) return native || english || "Voter";

  return english || native || "Voter";
}

/**
 * What the roll's RELATION_TYPE says the relative is. Rolls abbreviate it to a
 * single letter; anything unrecognised falls back to the neutral wording rather
 * than calling a husband a father.
 */
export function relationLabel(voter: Pick<LocalVoter, "relationType">): string {
  const code = (voter.relationType ?? "").trim().toUpperCase();

  if (code.startsWith("F")) return "Father";
  if (code.startsWith("H")) return "Husband";
  if (code.startsWith("M")) return "Mother";
  if (code.startsWith("W")) return "Wife";

  return "Relative";
}

/** The father's or husband's name, in the same script as the voter's own. */
export function voterRelativeName(
  voter: LocalVoter,
  language: NameLanguage = "english",
): string | null {
  if (language === "native") return voter.lMiddleName || voter.eMiddleName;

  return voter.eMiddleName || voter.lMiddleName;
}

function dialable(mobile: string | null): string | null {
  const digits = (mobile ?? "").replace(/\D/g, "");

  if (digits.length < 10) return null;

  return digits.length === 10 ? `${COUNTRY_CODE}${digits}` : digits;
}

/**
 * The voter's number as WhatsApp wants it, only when it is a real Indian
 * mobile: ten digits starting 6–9, with or without the 91 in front. Numbers
 * typed with a digit missing or extra cannot have a WhatsApp chat.
 */
function whatsappNumber(mobile: string | null): string | null {
  let digits = (mobile ?? "").replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return /^[6-9]\d{9}$/.test(digits) ? `${COUNTRY_CODE}${digits}` : null;
}

export function hasMobile(voter: LocalVoter): boolean {
  return dialable(voter.mobileNo1) !== null;
}

async function open(url: string, fallback: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Can't open that", fallback);
  }
}

export async function callVoter(voter: LocalVoter) {
  const number = dialable(voter.mobileNo1);

  if (!number) return;

  await open(`tel:+${number}`, "No dialler is available on this phone.");
}

/** What the message needs from the constituency; every field may be unset. */
export type SlipContext = Pick<
  Access,
  "assemblyNo" | "assemblyName" | "electionTitle" | "pollDate" | "pollTime"
> | null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-11" -> "11-Feb-2026", as printed on the slip. */
function pollDateLabel(iso: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;

  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

const DIVIDER = "=======================";

/**
 * Constituencies whose slips leave out the constituency number: their number
 * (e.g. Sabbavaram MPTC-1, filed as 32) is not the one on the roll.
 */
const HIDE_ASSEMBLY_NO = new Set<number>([32]);

/** "Assembly 31 - Booth 4", or just "Booth 4" where the number is hidden. */
function assemblyBoothLine(assemblyNo: number, partNo: number, separator: string): string {
  return HIDE_ASSEMBLY_NO.has(assemblyNo)
    ? `Booth ${partNo}`
    : `Assembly ${assemblyNo}${separator}Booth ${partNo}`;
}

/**
 * Constituencies that asked for their own heading (in place of the election
 * title and assembly line) and the candidate's appeal to end the message.
 * `appeal`, when set, sits between the voter's details and the last divider,
 * leaving `closing` as the sign-off under it.
 */
const CUSTOM_MESSAGES: Record<number, { heading: string[]; appeal?: string[]; closing: string[] }> = {
  100: {
    heading: ["GVMC MUNICIPAL ELECTION 2026", "Assembly: 100 - GVMC Ward 100"],
    appeal: [
      "స్వతంత్ర అభ్యర్థి",
      "",
      "100వ వార్డు కార్పొరేటర్ అభ్యర్థి",
      "*శ్రీ లేళ్ళ కోటేశ్వరరావు గారికి*",
      "",
      "మీ అమూల్యమైన, అతి విలువైన ఓటు మద్దతును",
      "",
      "“ఉంగరం” గుర్తుపై (సీరియల్ నంబర్: 8)",
      "",
      "వేసి భారీ మెజారిటీతో గెలిపించండి.",
      "",
    ],
    closing: ["మీ మద్దతుకు ధన్యవాదాలు.", DIVIDER],
  },
  119: {
    heading: ["*GVMC MUNICIPAL ELECTION 2026*", "Assembly: 119 - GVMC Ward 119"],
    appeal: [
      "టీడీపీ మరియు జనసేన బలపరిచిన బీజేపీ అభ్యర్థి",
      "",
      "శ్రీ గొర్లె రాము నాయుడు గారికి",
      "",
      "మీ అమూల్యమైన, అతి విలువైన ఓటు మద్దతును",
      "",
      "“కమలం” గుర్తుపై వేసి భారీ మెజారిటీతో గెలిపించండి.",
      "",
    ],
    closing: ["Thank you for your support."],
  },
  115: {
    heading: ["GVMC MUNICIPAL ELECTION 2026", "Ward : 115"],
    closing: [
      "PLEASE VOTE FOR SANAPATHI SOMA SEKHAR NAIDU",
      "",
      "SYMBOL: GLASS TUMBLER",
      "",
      "COALITION CANDIDATE FROM TDP-JSP-BJP",
      "",
      "THANK YOU.",
    ],
  },
};

/** The relative's label in Telugu, by the roll's relation type. */
const TELUGU_RELATION: Record<string, string> = {
  Father: "తండ్రి పేరు",
  Husband: "భర్త పేరు",
  Mother: "తల్లి పేరు",
  Wife: "భార్య పేరు",
  Relative: "బంధువు పేరు",
};

const THIN_DIVIDER = "━━━━━━━━━━━━━━";

/**
 * Constituencies whose message is laid out entirely their own way, Telugu
 * labels and all, rather than the common layout with a custom heading and
 * closing. Single *stars* are WhatsApp's bold. Lines with nothing to show are
 * dropped, as in the common layout.
 */
const FULL_MESSAGES: Record<number, (voter: LocalVoter) => (string | null)[]> = {
  113: (voter) => {
    const relative = voterRelativeName(voter, "english");

    return [
      "*GVMC MUNICIPAL ELECTION 2026*",
      "*వార్డు నం.: 113*",
      "",
      `పేరు: ${voterFullName(voter, "english")}`,
      relative ? `${TELUGU_RELATION[relationLabel(voter)]}: ${relative}` : null,
      voter.vcardId ? `EPIC ID: ${voter.vcardId}` : null,
      `బూత్ నం.: ${voter.partNo}`,
      voter.eBoothAddress ? `బూత్ చిరునామా: ${voter.eBoothAddress}` : null,
      `సీరియల్ నం.: ${voter.srNo}`,
      "",
      THIN_DIVIDER,
      "",
      "🙏 *దయచేసి మీ అమూల్యమైన ఓటును వేయండి* 🙏",
      "",
      "🚲 *మేయర్ అభ్యర్థిని: డాక్టర్ ముక్క శ్రావణి గారు*",
      "",
      "🥛 *కార్పొరేటర్ అభ్యర్థి: ఇందల వెంకటరమణ గారు – గుర్తు: గాజు గ్లాస్*",
      "",
      THIN_DIVIDER,
      "",
      "టీడీపీ – జనసేన – బీజేపీ కూటమి అభ్యర్థులైన *ముక్క శ్రావణి గారికి, ఇందల వెంకటరమణ గారికి* మీ అమూల్యమైన ఓటుతో మద్దతు తెలియజేయండి.",
      "",
      "*ధన్యవాదాలు!* 🙏",
    ];
  },
  31: (voter) => {
    const relative = voterRelativeName(voter, "english");

    return [
      "*సబ్బవరం MPTC-4*",
      "",
      `పేరు: ${voterFullName(voter, "english")}`,
      relative ? `${TELUGU_RELATION[relationLabel(voter)]}: ${relative}` : null,
      voter.vcardId ? `EPIC ID: ${voter.vcardId}` : null,
      `బూత్ నం.: ${voter.partNo}`,
      voter.eBoothAddress ? `బూత్ చిరునామా: ${voter.eBoothAddress}` : null,
      `సీరియల్ నం.: ${voter.srNo}`,
      "",
      THIN_DIVIDER,
      "",
      "🙏 *మీ అమూల్యమైన ఓటు వేసి అఖండ మెజారిటీతో గెలిపించండి!* 🙏",
      "",
      "*MPTC అభ్యర్థి: గొర్లి పార్వతి*",
      "*గుర్తు: 🥛 గాజు గ్లాస్*",
      "",
      "*ZPTC అభ్యర్థి: మామిడి అరుణ*",
      "*గుర్తు: 🥛 గాజు గ్లాస్*",
      "",
      THIN_DIVIDER,
      "",
      "మన ప్రాంత అభివృద్ధి కోసం పోటీ చేస్తున్న మన అభ్యర్థులైన గొర్లి పార్వతి గారికి, మామిడి అరుణ గారికి మీ అమూల్యమైన ఓటును గాజు గ్లాస్ గుర్తుపై వేసి, అత్యధిక మెజారిటీతో గెలిపించాలని మనస్ఫూర్తిగా కోరుకుంటున్నాము.",
      "",
      "*మీ ఓటు – మన అభ్యర్థుల విజయం!*",
    ];
  },
  32: (voter) => {
    const relative = voterRelativeName(voter, "english");

    return [
      "*సబ్బవరం MPTC-1*",
      "",
      `పేరు: ${voterFullName(voter, "english")}`,
      relative ? `${TELUGU_RELATION[relationLabel(voter)]}: ${relative}` : null,
      voter.vcardId ? `EPIC ID: ${voter.vcardId}` : null,
      `బూత్ నం.: ${voter.partNo}`,
      voter.eBoothAddress ? `బూత్ చిరునామా: ${voter.eBoothAddress}` : null,
      `సీరియల్ నం.: ${voter.srNo}`,
      "",
      THIN_DIVIDER,
      "",
      "🙏 *మీ అమూల్యమైన ఓటు వేసి అఖండ మెజారిటీతో గెలిపించండి!* 🙏",
      "",
      "*MPTC అభ్యర్థి: రోమాల చంద్రశేఖర్*",
      "*గుర్తు: 🥛 గాజు గ్లాస్*",
      "",
      THIN_DIVIDER,
      "",
      "మన ప్రాంత అభివృద్ధి కోసం పోటీ చేస్తున్న మన అభ్యర్థి రోమాల చంద్రశేఖర్ గారికి మీ అమూల్యమైన ఓటును గాజు గ్లాస్ గుర్తుపై వేసి, అత్యధిక మెజారిటీతో గెలిపించాలని మనస్ఫూర్తిగా కోరుకుంటున్నాము.",
      "",
      "*మీ ఓటు – మన అభ్యర్థి విజయం!*",
    ];
  },
};

/**
 * The voter slip as sent on WhatsApp and SMS. Lines with nothing to show are
 * dropped rather than sent blank; the dividers always stay so the layout holds.
 *
 * Names are always English, whatever the app's name language is set to — as on
 * the printed slip. A voter with no English spelling on the roll still falls
 * back to the native one rather than going out blank.
 */
export function messageText(voter: LocalVoter, context: SlipContext = null): string {
  const assemblyName = context?.assemblyName ?? voter.eAssemblyName;
  const relative = voterRelativeName(voter, "english");
  const pollDate = pollDateLabel(context?.pollDate);
  const assemblyNo = context?.assemblyNo ?? voter.assemblyNo;
  const full = FULL_MESSAGES[assemblyNo];

  if (full) return full(voter).filter((line) => line !== null).join("\n");

  const custom = CUSTOM_MESSAGES[assemblyNo];
  const heading = custom?.heading ?? [
    context?.electionTitle || null,
    assemblyName
      ? HIDE_ASSEMBLY_NO.has(assemblyNo)
        ? assemblyName
        : `Assembly: ${assemblyNo} - ${assemblyName}`
      : null,
  ];
  const closing = custom?.closing ?? ["Thank you for your support"];

  return [
    ...heading,
    DIVIDER,
    `Name: ${voterFullName(voter, "english")}`,
    relative ? `${relationLabel(voter)} : ${relative}` : null,
    voter.vcardId ? `EPIC ID: ${voter.vcardId}` : null,
    `BOOTH #: ${voter.partNo}`,
    voter.eBoothAddress ? `Booth Address: ${voter.eBoothAddress}` : null,
    `SERIAL #: ${voter.srNo}`,
    DIVIDER,
    pollDate ? `Vote On: ${pollDate}` : null,
    context?.pollTime ? `Voting Time: ${context.pollTime}` : null,
    ``,
    ...(custom?.appeal ?? []),
    DIVIDER,
    ...closing,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Opens WhatsApp with the slip text. With a number, straight into that chat —
 * this works for any number, saved in the agent's contacts or not; without
 * one, WhatsApp's own contact picker chooses who gets it.
 */
export async function whatsappVoter(voter: LocalVoter, context: SlipContext = null) {
  const text = messageText(voter, context);
  const phone = whatsappNumber(voter.mobileNo1);

  await open(
    `whatsapp://send?${phone ? `phone=${phone}&` : ""}text=${encodeURIComponent(text)}`,
    "WhatsApp is not installed on this phone.",
  );
}

/**
 * The WhatsApp button: the plain text, or the image with the text as its
 * caption. With the voter's number both go straight to their chat; the image
 * goes in two steps (a greeting, then the image), since WhatsApp attaches an
 * image to a chat it opens directly only for numbers it already knows.
 * Without a number, WhatsApp asks which chat to send to.
 */
export function shareVoterOnWhatsApp(voter: LocalVoter, context: SlipContext = null) {
  const text = messageText(voter, context);
  const assemblyNo = context?.assemblyNo ?? voter.assemblyNo;

  const sendText = () => void whatsappVoter(voter, context);
  // Whether that number has WhatsApp cannot be checked from the phone, but a
  // missing or mistyped one certainly does not.
  const phone = whatsappNumber(voter.mobileNo1);

  const sendImage = async () => {
    const outcome = phone
      ? await shareCoverAfterGreeting(assemblyNo, text, phone)
      : await shareCoverWithText(assemblyNo, text, null);

    if (outcome === "sent") return;

    Alert.alert(
      outcome === "no-image" ? "No WhatsApp image yet" : "Could not attach the image",
      outcome === "no-image"
        ? "This constituency has no WhatsApp image downloaded on this phone. Sending the text only."
        : "WhatsApp could not take the image. Sending the text only.",
      [{ text: "OK", onPress: sendText }],
    );
  };

  Alert.alert(
    "Send Whatsapp Message",
    phone
      ? "Text With Image takes two steps: send the greeting, come back to this app, then send the image."
      : "This voter has no valid mobile number, so WhatsApp will ask which chat to send it to.",
    [
      { text: "Only Text", onPress: sendText },
      { text: "Text With Image", onPress: () => void sendImage() },
      { text: "Cancel", style: "cancel" as const },
    ],
  );
}

export async function smsVoter(voter: LocalVoter, context: SlipContext = null) {
  const number = dialable(voter.mobileNo1);

  if (!number) return;

  await open(
    `sms:+${number}?body=${encodeURIComponent(messageText(voter, context))}`,
    "No messaging app is available.",
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}

function slipRow(label: string, value: string | number | null): string {
  if (value === null || value === "") return "";

  return `<tr><td class="label">${escapeHtml(label)}</td><td>${escapeHtml(String(value))}</td></tr>`;
}

/** Wraps to the paper width, indenting continuations under the value column. */
function wrap(text: string, indent = 0, width = PRINTER_COLUMNS): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length <= width) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);

    // A single word longer than the paper is cut rather than lost.
    line = pad + word;

    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = pad + line.slice(width);
    }
  }

  if (line) lines.push(line);

  return lines;
}

const LABEL_WIDTH = 9;

function slipField(label: string, value: string | number | null, width = PRINTER_COLUMNS): string[] {
  if (value === null || value === undefined || value === "") return [];

  return wrap(`${label.padEnd(LABEL_WIDTH)}: ${value}`, LABEL_WIDTH + 2, width);
}

/**
 * The thermal slip. Names are taken in English regardless of the app's name
 * language: the printer has no Telugu or Hindi font, so a native-script name
 * would reach the paper as blanks.
 */
export function voterSlipBlocks(
  rows: LocalVoter[],
  cover?: string | null,
  cutNote?: string | null,
): ReceiptBlock[] {
  const head = rows[0]!;

  const blocks: ReceiptBlock[] = [
    ...(cover ? ([{ type: "image", uri: cover }] as ReceiptBlock[]) : []),
    // Under the banner, in Telugu (drawn as an image: the printer has no Telugu
    // font): cut the banner off and do not take it into the polling station.
    ...(cover && cutNote ? ([{ type: "image", uri: cutNote }] as ReceiptBlock[]) : []),
    // Between the cover and the details: the cut separates the artwork heading
    // the strip from the voter's own particulars below it.
    { type: "cut" },
    { type: "text", text: "VOTER SLIP", align: "center", bold: true },
    { type: "text", text: head.eAssemblyName ?? "Voter slip" },
    { type: "text", text: assemblyBoothLine(head.assemblyNo, head.partNo, " - ") },
    { type: "rule" },
  ];

  const push = (lines: string[], options: { bold?: boolean; size?: ReceiptSize } = {}) => {
    for (const line of lines) blocks.push({ type: "text", text: line, ...options });
  };

  for (const [index, row] of rows.entries()) {
    if (index > 0) blocks.push({ type: "rule" });

    // Labelled like every other row so the colons line up down the slip.
    // Bold lines are spaced out, so they wrap at fewer columns.
    push(slipField("Name", voterFullName(row, "english").toUpperCase(), BOLD_COLUMNS), { bold: true });
    push([
      ...slipField("Relative", voterRelativeName(row, "english")),
      ...slipField("Sex/Age", `${row.sex ?? "-"} / ${row.age ?? "-"}`),
    ]);

    // The two things actually checked at the gate, so they are set tall. The
    // mobile number is deliberately absent: the slip is handed to the voter and
    // often left at the booth, and it does not need their number printed on it.
    push(slipField("Voter ID", row.vcardId, BOLD_COLUMNS), { bold: true, size: "tall" });
    push(slipField("Serial", row.srNo, BOLD_COLUMNS), { bold: true, size: "tall" });
    // A gram panchayat votes ward by ward: the ward is asked for at the gate too.
    if (row.wardNo !== null) push(slipField("Ward", row.wardNo, BOLD_COLUMNS), { bold: true, size: "tall" });

    push([...slipField("House", row.houseNo), ...slipField("Village", row.eVillage)]);
  }

  // The booth number is the one thing a voter is asked for at the gate, so it
  // is set double-size at the foot of the slip where it can be read at a glance
  // rather than hunted for in the field list above.
  blocks.push(
    { type: "rule" },
    {
      type: "text",
      text: `POLLING BOOTH : ${head.partNo}`,
      align: "center",
      bold: true,
      // Double height rather than double width: at double width the line is
      // only 16 columns and this label plus a three-digit booth would wrap.
      size: "tall",
    },
  );

  // Where the booth is, straight under its number: the two are read together.
  if (head.eBoothAddress) {
    for (const line of wrap(head.eBoothAddress)) blocks.push({ type: "text", text: line, align: "center" });
  }

  // Closes the slip, so the booth lines read as a boxed footer rather than
  // trailing off into the blank feed below them.
  blocks.push({ type: "rule" });

  // The sign-off under the box. 27 characters, so it fits the bold line's 27
  // columns; double height to carry like the booth number above.
  blocks.push({ type: "text", text: "Thank you for your support!", align: "center", bold: true, size: "tall" });

  return blocks;
}

/**
 * The cover image for the top of a slip, or null for none: only where the
 * constituency prints slip images and this phone has not switched them off.
 * In a gram panchayat a voter's ward banner (its candidate's symbol) prints
 * in place of the usual cover; a ward without one falls back to it.
 */
async function slipCoverToPrint(voter: Pick<LocalVoter, "assemblyNo" | "wardNo">): Promise<string | null> {
  const access = await loadAccess();

  if (!access?.printSlipImage || !(await isImagePrintEnabled())) return null;

  if (access.isPanchayat && voter.wardNo !== null) {
    const ward = cachedWardBannerUri(voter.assemblyNo, voter.wardNo);

    if (ward) return ward;
  }

  return printableSlipCoverUri(voter.assemblyNo, access.allowUserSlipCovers);
}

/**
 * What happened, so the screen can show the right thing. A print is logged in
 * the background once the GPS fix is in, which can take seconds: `recorded`
 * settles when the row is on the phone, so a sync chained on it has
 * something to push. (Before, the sync ran at once and found nothing.)
 */
export type PrintOutcome =
  | { kind: "printed"; recorded: Promise<void> }
  | { kind: "dialog"; recorded: Promise<void> }
  | { kind: "failed"; message: string; printed?: LocalVoter[] };

/**
 * Prints to the agent's paired thermal printer when one is connected. Android's
 * print framework cannot see a Bluetooth SPP printer — it only lists system
 * print services — so routing through `expo-print` there opens a dialog with no
 * printer to pick. That dialog stays as the fallback for phones with no thermal
 * printer set up, where it can still reach a Wi-Fi or cloud printer or save a PDF.
 */
export async function printVoter(
  voter: LocalVoter,
  extra: LocalVoter[] = [],
  language: NameLanguage = "english",
): Promise<PrintOutcome> {
  const rows = [voter, ...extra];

  const printer = await connectedPrinter({ reconnect: true }).catch(() => null);

  if (printer) {
    try {
      const cover = await slipCoverToPrint(voter);

      const cutNote = cover && (await isCutNoteEnabled()) ? await cutNoteUri() : null;

      await printReceipt(printer.address, voterSlipBlocks(rows, cover, cutNote));

      return { kind: "printed", recorded: recordPrint(rows, "printer") };
    } catch {
      return {
        kind: "failed",
        message:
          "The printer did not accept the slip. Check it is switched on and in range, or reconnect it from the Printer screen.",
      };
    }
  }

  const html = `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: -apple-system, Roboto, sans-serif; padding: 24px; color: #041D7A; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 15px; margin: 24px 0 8px; }
          .sub { color: #637094; font-size: 12px; margin-bottom: 16px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
          td { border-bottom: 1px solid #DBE3F3; padding: 7px 4px; font-size: 13px; }
          .label { color: #637094; width: 42%; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(voter.eAssemblyName ?? "Voter slip")}</h1>
        <div class="sub">${assemblyBoothLine(voter.assemblyNo, voter.partNo, " · ")}</div>
        ${rows
          .map(
            (row) => `
              <h2>${escapeHtml(voterFullName(row, language))}</h2>
              <table>
                ${slipRow("Relative", voterRelativeName(row, language))}
                ${slipRow("Sex / Age", `${row.sex ?? "—"} / ${row.age ?? "—"}`)}
                ${slipRow("Voter ID", row.vcardId)}
                ${slipRow("Booth (part)", row.partNo)}
                ${slipRow("Serial number", row.srNo)}
                ${row.wardNo !== null ? slipRow("Ward", row.wardNo) : ""}
                ${slipRow("House", row.houseNo)}
                ${slipRow("Village / area", row.eVillage)}
                ${slipRow("Booth address", row.eBoothAddress)}
                ${slipRow("Mobile", row.mobileNo1)}
              </table>`,
          )
          .join("")}
      </body>
    </html>`;

  await Print.printAsync({ html });

  // The dialog gives no word on whether a page came out; the slip reaching it
  // is the nearest thing to a print there is.
  return { kind: "dialog", recorded: recordPrint(rows, "dialog") };
}

/**
 * Bulk printing: one full slip per voter — cover image, cut note and all, the
 * same as printing that voter alone — fed out one after another so the agent
 * tears them apart and hands each voter their own. Without a thermal printer
 * the system dialog gets them all at once, as `printVoter` does.
 *
 * Stops at the first slip the printer refuses; the ones already out are still
 * logged, and the failure says how many made it.
 */
export async function printVotersSeparately(
  rows: LocalVoter[],
  language: NameLanguage = "english",
): Promise<PrintOutcome> {
  const [first, ...rest] = rows;

  if (!first) return { kind: "failed", message: "No voters were selected." };

  const printer = await connectedPrinter({ reconnect: true }).catch(() => null);

  if (!printer) return printVoter(first, rest, language);

  // Looked up once per ward for the whole run, not once per slip: a run can
  // span wards, and each ward's slips carry that ward's banner.
  const covers = new Map<number | null, string | null>();
  const coverFor = async (row: LocalVoter) => {
    if (!covers.has(row.wardNo)) covers.set(row.wardNo, await slipCoverToPrint(row));

    return covers.get(row.wardNo) ?? null;
  };
  const cutNote = (await coverFor(first)) && (await isCutNoteEnabled()) ? await cutNoteUri() : null;

  const printed: LocalVoter[] = [];

  for (const row of rows) {
    try {
      const cover = await coverFor(row);

      await printReceipt(printer.address, voterSlipBlocks([row], cover, cover ? cutNote : null));
      printed.push(row);
    } catch {
      if (printed.length > 0) void recordPrint(printed, "printer");

      return {
        kind: "failed",
        printed,
        message:
          `${printed.length} of ${rows.length} slips printed before the printer stopped. ` +
          "Check it is switched on, has paper and is in range, then print the rest.",
      };
    }
  }

  return { kind: "printed", recorded: recordPrint(printed, "printer") };
}

const CUT_NOTE = require("@/assets/images/slip-cut-note.png");

/** The bundled Telugu cut note as a file the printer code can read; null if it cannot be loaded. */
async function cutNoteUri(): Promise<string | null> {
  try {
    const [asset] = await Asset.loadAsync(CUT_NOTE);

    return asset?.localUri ?? null;
  } catch {
    return null;
  }
}

/**
 * Logs the print with where the phone is, without holding up the screen: the
 * GPS fix can take seconds and the slip is already in the agent's hand. The
 * returned promise settles once the row is written (or the write has failed
 * and been logged), never rejects, and is what to chain a sync on.
 */
function recordPrint(rows: LocalVoter[], method: "printer" | "dialog"): Promise<void> {
  return currentFix()
    .then((fix) => recordSlipPrints(rows, method, fix))
    .catch((error: unknown) => {
      console.warn("could not record the slip print", error);
    });
}
