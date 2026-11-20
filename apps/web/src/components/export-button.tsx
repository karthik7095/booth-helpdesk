import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A CSV download of a constituency's voters. The page renders it only when
 * there are rows, so there is never an empty file to download.
 */
export function ExportButton({
  kind,
  params = {},
  label = "Export CSV",
}: {
  kind: "voters";
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]),
  ).toString();

  return (
    <Button asChild variant="outline" size="sm">
      {/* A plain link: the browser streams the file straight to disk. */}
      <a href={`/api/export/${kind}${query ? `?${query}` : ""}`} download>
        <Download className="size-4" />
        {label}
      </a>
    </Button>
  );
}
