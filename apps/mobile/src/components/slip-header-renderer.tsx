import { DEFAULT_SLIP_TAGLINE } from "@voter/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Text as NativeText, View } from "react-native";
import Svg, { ClipPath, Defs, Image as SvgImage, Rect, Text as SvgText } from "react-native-svg";

/**
 * Draws a panchayat ward's slip header (design B: an optional image across the
 * top, the Sarpanch (or Mayor) candidate and the ward member (or Corporator)
 * candidate in two full-width boxes, symbol or photo left, name right, then
 * the vote line) and hands it back as a PNG, which becomes the ward's
 * print banner. The thermal printer has no Telugu font, so the header is drawn
 * here, where Android shapes Telugu, like the typed text covers.
 *
 * Drawn at 576 px, 1.5x the 384-dot head, and scaled down to print. Each name
 * is measured off-screen first and set as large as fits.
 */

export type SlipHeaderData = {
  heading: string | null;
  tagline: string | null;
  sarpanchName: string | null;
  sarpanchNameEn: string | null;
  /** data: URI, or null to leave the symbol box empty. */
  sarpanchSymbol: string | null;
  wardNo: number;
  memberName: string | null;
  memberNameEn: string | null;
  memberSymbol: string | null;
  /** MAYOR / WARD n CORPORATOR instead of SARPANCH / WARD n MEMBER, with photos filling the boxes. */
  municipal: boolean;
  /** Printed across the top, above the heading (a party badge); null for none. */
  topImage: { uri: string; width: number; height: number } | null;
};

/** The two box labels. */
export function slipRoles(municipal: boolean, wardNo: number): [string, string] {
  return municipal ? ["MAYOR", `WARD ${wardNo} CORPORATOR`] : ["SARPANCH", `WARD ${wardNo} MEMBER`];
}

export type SlipHeaderRendererHandle = {
  /** Resolves with the header as base64 PNG. One at a time. */
  render: (data: SlipHeaderData) => Promise<string>;
};

const WIDTH = 576;
const PAD = 18;
const BOX_H = 204;
const SYMBOL = 172;
const TEXT_X = PAD + 16 + SYMBOL + 18;
const TEXT_W = WIDTH - PAD - 16 - TEXT_X;
const GAP = 14;
const TAG_H = 56;

/** Every line that is fitted: its text, the size it is measured at, its width budget and smallest size. */
type Fit = { key: string; text: string; base: number; max: number; min: number; spacing?: number };

function fitsFor(data: SlipHeaderData): Fit[] {
  const [role1, role2] = slipRoles(data.municipal, data.wardNo);
  const lines: Fit[] = [
    { key: "heading", text: data.heading ?? "", base: 34, max: WIDTH - PAD * 2, min: 18 },
    { key: "pill1", text: role1, base: 21, max: TEXT_W, min: 14, spacing: 2 },
    { key: "pill2", text: role2, base: 21, max: TEXT_W, min: 14, spacing: 2 },
    { key: "name1", text: data.sarpanchName ?? "", base: 42, max: TEXT_W, min: 20 },
    { key: "name2", text: data.memberName ?? "", base: 42, max: TEXT_W, min: 20 },
    { key: "en1", text: data.sarpanchNameEn ?? "", base: 22, max: TEXT_W, min: 13 },
    { key: "en2", text: data.memberNameEn ?? "", base: 22, max: TEXT_W, min: 13 },
    { key: "tagline", text: data.tagline ?? DEFAULT_SLIP_TAGLINE, base: 30, max: WIDTH - PAD * 2 - 24, min: 16 },
  ];

  return lines.filter((line) => line.text.trim());
}

type Job = {
  data: SlipHeaderData;
  resolve: (png: string) => void;
  reject: (error: Error) => void;
};

export const SlipHeaderRenderer = forwardRef<SlipHeaderRendererHandle>(function SlipHeaderRenderer(_, ref) {
  const [job, setJob] = useState<Job | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(0);
  const svg = useRef<Svg>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useImperativeHandle(ref, () => ({
    render: (data) => {
      const run = () =>
        new Promise<string>((resolve, reject) => {
          setWidths({});
          setLoaded(0);
          setJob({ data, resolve, reject });
        });
      const next = queue.current.then(run, run);

      queue.current = next.catch(() => undefined);

      return next;
    },
  }));

  const fits = job ? fitsFor(job.data) : [];
  const images = job ? [job.data.sarpanchSymbol, job.data.memberSymbol, job.data.topImage].filter(Boolean).length : 0;
  const measured = job !== null && fits.every((fit) => widths[fit.key] !== undefined);

  const size = (key: string): number => {
    const fit = fits.find((line) => line.key === key);

    if (!fit) return 0;

    const width = widths[key];

    if (!width) return fit.base;

    return Math.max(fit.min, Math.min(fit.base, Math.floor((fit.base * fit.max) / width)));
  };

  // Layout, top to bottom.
  const data = job?.data;
  const headingSize = size("heading");
  const top = data?.topImage ?? null;
  const topW = WIDTH - PAD * 2;
  const topH = top && top.width > 0 ? Math.round((topW * top.height) / top.width) : 0;
  let y = PAD;

  if (topH) y += topH + GAP;

  const headingY = headingSize ? y + headingSize : 0;

  if (headingSize) y += headingSize * 1.35 + 8;

  const box1 = y;
  const box2 = box1 + BOX_H + GAP;
  const tagY = box2 + BOX_H + GAP;
  const height = Math.round(tagY + TAG_H + PAD);

  useEffect(() => {
    if (!job || !measured || loaded < images) return;

    let done = false;
    // Two frames so the native view has drawn the last change before it is read.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        svg.current?.toDataURL(
          (base64) => {
            done = true;
            job.resolve(base64);
            setJob(null);
          },
          { width: WIDTH, height },
        );
      }),
    );
    const timeout = setTimeout(() => {
      if (done) return;
      job.reject(new Error("Could not draw the slip header."));
      setJob(null);
    }, 10_000);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [job, measured, loaded, images, height]);

  // A symbol that never loads must not hold the job forever.
  useEffect(() => {
    if (!job || images === 0) return;

    const timer = setTimeout(() => setLoaded(images), 4000);

    return () => clearTimeout(timer);
  }, [job, images]);

  if (!job || !data) return null;

  const box = (index: number, top: number, pill: string, pillKey: string, name: string | null, nameKey: string, en: string | null, enKey: string, symbol: string | null) => {
    const pillSize = size(pillKey);
    const pillW = Math.min(TEXT_W, (widths[pillKey] ?? 0) * (pillSize / 21) + 24);
    const nameSize = size(nameKey);
    const enSize = size(enKey);
    const pillTop = top + 30;
    const nameY = pillTop + 36 + 14 + (nameSize || 42) * 0.95;
    const enY = nameY + 14 + (enSize || 22);

    return (
      <>
        <Rect x={PAD + 2} y={top + 2} width={WIDTH - PAD * 2 - 4} height={BOX_H - 4} rx={16} fill="#fff" stroke="#000" strokeWidth={4} />
        <Rect x={PAD + 16} y={top + (BOX_H - SYMBOL) / 2} width={SYMBOL} height={SYMBOL} rx={14} fill="#fff" stroke="#000" strokeWidth={4} />
        {symbol ? (
          <>
            <Defs>
              <ClipPath id={`photo${index}`}>
                <Rect x={PAD + 16 + 4} y={top + (BOX_H - SYMBOL) / 2 + 4} width={SYMBOL - 8} height={SYMBOL - 8} rx={11} />
              </ClipPath>
            </Defs>
            {/* A symbol is shown whole; a candidate's photo fills the box from the top (head and shoulders). */}
            <SvgImage
              href={{ uri: symbol }}
              x={data.municipal ? PAD + 16 + 4 : PAD + 16 + 8}
              y={top + (BOX_H - SYMBOL) / 2 + (data.municipal ? 4 : 8)}
              width={data.municipal ? SYMBOL - 8 : SYMBOL - 16}
              height={data.municipal ? SYMBOL - 8 : SYMBOL - 16}
              preserveAspectRatio={data.municipal ? "xMidYMin slice" : "xMidYMid meet"}
              clipPath={`url(#photo${index})`}
              onLoad={() => setLoaded((count) => count + 1)}
            />
          </>
        ) : null}
        <Rect x={TEXT_X} y={pillTop} width={pillW} height={36} rx={6} fill="#000" />
        <SvgText x={TEXT_X + 12} y={pillTop + 25} fontSize={pillSize} fontWeight="bold" fill="#fff" letterSpacing={2}>
          {pill}
        </SvgText>
        {name ? (
          <SvgText x={TEXT_X} y={nameY} fontSize={nameSize} fontWeight="bold" fill="#000">
            {name}
          </SvgText>
        ) : null}
        {en ? (
          <SvgText x={TEXT_X} y={enY} fontSize={enSize} fontWeight="bold" fill="#000" fontFamily="monospace">
            {en}
          </SvgText>
        ) : null}
      </>
    );
  };

  return (
    // Off-screen: drawn only to be read back as a picture.
    <View pointerEvents="none" style={{ position: "absolute", left: -10_000, top: 0, width: 4_000 }}>
      {fits.map((fit) => (
        <NativeText
          key={`${fit.key}:${fit.text}`}
          style={{
            alignSelf: "flex-start",
            fontSize: fit.base,
            fontWeight: "bold",
            letterSpacing: fit.spacing ?? 0,
            fontFamily: fit.key.startsWith("en") ? "monospace" : undefined,
          }}
          numberOfLines={1}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;

            setWidths((current) => (current[fit.key] === width ? current : { ...current, [fit.key]: width }));
          }}
        >
          {fit.text}
        </NativeText>
      ))}

      {measured ? (
        <Svg ref={svg} width={WIDTH} height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
          <Rect x={0} y={0} width={WIDTH} height={height} fill="#fff" />
          {top && topH ? (
            <SvgImage
              href={{ uri: top.uri }}
              x={PAD}
              y={PAD}
              width={topW}
              height={topH}
              preserveAspectRatio="xMidYMid meet"
              onLoad={() => setLoaded((count) => count + 1)}
            />
          ) : null}
          {headingSize ? (
            <SvgText x={WIDTH / 2} y={headingY} fontSize={headingSize} fontWeight="bold" fill="#000" textAnchor="middle">
              {data.heading}
            </SvgText>
          ) : null}
          {box(1, box1, slipRoles(data.municipal, data.wardNo)[0], "pill1", data.sarpanchName, "name1", data.sarpanchNameEn, "en1", data.sarpanchSymbol)}
          {box(2, box2, slipRoles(data.municipal, data.wardNo)[1], "pill2", data.memberName, "name2", data.memberNameEn, "en2", data.memberSymbol)}
          <Rect x={PAD} y={tagY} width={WIDTH - PAD * 2} height={TAG_H} rx={10} fill="#000" />
          <SvgText
            x={WIDTH / 2}
            y={tagY + TAG_H / 2 + size("tagline") * 0.36}
            fontSize={size("tagline")}
            fontWeight="bold"
            fill="#fff"
            textAnchor="middle"
          >
            {data.tagline ?? DEFAULT_SLIP_TAGLINE}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
});
