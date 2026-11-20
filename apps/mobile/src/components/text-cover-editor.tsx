import { useRef, useState } from "react";
import { Pressable, Text as NativeText, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { Input, InputField } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";

/** Drawn at 576 px wide, 1.5x the 384-dot thermal head, and scaled down to print. */
const WIDTH = 576;
const PADDING = 18;
const MAX_LINE_WIDTH = WIDTH - PADDING * 2;
const BASE_SIZE = 56;
const MIN_SIZE = 22;
const LINE_GAP = 1.3;
const MAX_LINES = 5;

/**
 * A slip cover made from typed text instead of a picture: each line centred in
 * bold, sized to fill the slip's width. The thermal printer has no Telugu font,
 * so the text is drawn here (Android's own fonts shape Telugu) and saved as a
 * picture; from there it prints and shares exactly like an uploaded image.
 */
export function TextCoverEditor({
  initialText,
  saving,
  onSave,
  onCancel,
}: {
  initialText: string;
  saving: boolean;
  onSave: (text: string, pngBase64: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  // Each line's width at BASE_SIZE, measured off-screen by the native text engine.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const svg = useRef<Svg>(null);

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .slice(0, MAX_LINES);
  const visible = lines.filter(Boolean);
  const sizes = lines.map((line, index) => {
    const width = widths[index];

    if (!line || !width) return BASE_SIZE;

    return Math.max(MIN_SIZE, Math.min(BASE_SIZE, Math.floor((BASE_SIZE * MAX_LINE_WIDTH) / width)));
  });

  // Blank lines keep a little space between groups of text.
  const rows: { line: string; size: number; y: number }[] = [];
  let y = PADDING;

  lines.forEach((line, index) => {
    const size = line ? sizes[index]! : BASE_SIZE * 0.4;

    y += size * LINE_GAP;
    if (line) rows.push({ line, size, y: y - size * 0.3 });
  });

  const height = Math.max(120, Math.round(y + PADDING));

  const save = () =>
    svg.current?.toDataURL(
      (base64) => onSave(lines.join("\n").trim(), base64),
      { width: WIDTH, height },
    );

  return (
    <VStack space="sm">
      <Input className="h-auto min-h-24 rounded-xl border-border bg-background px-3 py-2">
        <InputField
          value={text}
          onChangeText={(next) => setText(next.split("\n").slice(0, MAX_LINES).join("\n"))}
          placeholder={"e.g.\nశ్రీ గొర్లె రాము నాయుడు\nVOTE FOR LOTUS"}
          multiline
          maxLength={200}
          textAlignVertical="top"
          className="min-h-20 text-base"
        />
      </Input>
      <Text className="text-xs text-muted-foreground">
        Up to {MAX_LINES} lines, in Telugu or English. Each line is sized to fit the slip.
      </Text>

      {/* Off-screen, on a very wide canvas, so each line reports its natural width. */}
      <View style={{ position: "absolute", left: -10000, top: 0, width: 5000 }} pointerEvents="none">
        {lines.map((line, index) => (
          <NativeText
            key={`${index}-${line}`}
            style={{ fontSize: BASE_SIZE, fontWeight: "bold", alignSelf: "flex-start" }}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;

              setWidths((current) => (current[index] === width ? current : { ...current, [index]: width }));
            }}
          >
            {line || " "}
          </NativeText>
        ))}
      </View>

      <Text className="text-xs font-bold tracking-wider text-muted-foreground">PREVIEW</Text>
      <Box className="overflow-hidden rounded-lg border border-border">
        <Svg ref={svg} width="100%" height={undefined} viewBox={`0 0 ${WIDTH} ${height}`} style={{ aspectRatio: WIDTH / height }}>
          <Rect x={0} y={0} width={WIDTH} height={height} fill="#FFFFFF" />
          {rows.map((row, index) => (
            <SvgText
              key={index}
              x={WIDTH / 2}
              y={row.y}
              fontSize={row.size}
              fontWeight="bold"
              fill="#000000"
              textAnchor="middle"
            >
              {row.line}
            </SvgText>
          ))}
        </Svg>
      </Box>

      <HStack space="sm">
        <Pressable
          onPress={onCancel}
          disabled={saving}
          className="h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card"
        >
          <Text className="text-sm font-semibold text-foreground">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={saving || visible.length === 0}
          className={`h-10 flex-1 items-center justify-center rounded-lg ${
            visible.length === 0 ? "bg-secondary" : "bg-primary"
          }`}
        >
          {saving ? (
            <Spinner />
          ) : (
            <Text
              className={`text-sm font-semibold ${
                visible.length === 0 ? "text-muted-foreground" : "text-primary-foreground"
              }`}
            >
              Save text cover
            </Text>
          )}
        </Pressable>
      </HStack>
    </VStack>
  );
}
