"use client";

import { ImageIcon, MessageCircle, Printer, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Serves the constituency images. They behave identically to upload but are
 * stored and versioned separately, so the only differences are the endpoint
 * they post to and the wording.
 */
const KINDS = {
  banner: {
    title: "Home screen banner",
    description:
      "Shown at the top of the app for anyone signing in with this constituency's PIN.",
    empty: "No banner yet — the app shows a plain placeholder. PNG, JPEG or WebP, up to 4 MB.",
    proxy: "/api/banner",
    accept: "image/png,image/jpeg,image/webp",
    icon: ImageIcon,
  },
  slip: {
    title: "Printer cover image",
    description:
      "Printed above every voter slip, when the agent turns it on in the app's Printer tab.",
    empty:
      "No cover image yet — slips print as text only. Use high-contrast artwork: it is reduced to black and white for the thermal printer, so photographs come out muddy.",
    proxy: "/api/slip-image",
    accept: "image/png,image/jpeg,image/webp",
    icon: Printer,
  },
  whatsapp: {
    title: "WhatsApp image or video",
    description:
      "Sent with the voter's slip text when an agent picks \"Text With Image\" on WhatsApp. An image up to 4 MB, or an MP4 video up to 16 MB.",
    empty:
      "No WhatsApp image yet — the app sends the printer cover image instead, or the text alone if there is none.",
    proxy: "/api/whatsapp-image",
    accept: "image/png,image/jpeg,image/webp,video/mp4",
    icon: MessageCircle,
  },
} as const;

export function BannerCard({
  assemblyId,
  bannerUpdatedAt,
  kind = "banner",
}: {
  assemblyId: string;
  bannerUpdatedAt: string | null;
  kind?: keyof typeof KINDS;
}) {
  const meta = KINDS[kind];
  const Icon = meta.icon;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  // The stored file's type is not in the page data; a video fails to load as an <img>.
  const [isVideo, setIsVideo] = useState(false);

  const upload = (file: File) => {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPreview(dataUrl);
      setIsVideo(file.type.startsWith("video/"));

      startTransition(async () => {
        const response = await fetch("/api/import/banner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assemblyId, dataUrl, kind }),
        });

        const payload = (await response.json()) as { message?: string };

        if (!response.ok) {
          toast.error(payload.message ?? "Could not save that image.");
          setPreview(null);
          return;
        }

        toast.success(`${meta.title} updated — the app picks it up on its next launch.`);
        router.refresh();
      });
    };

    reader.readAsDataURL(file);
  };

  // Cache-busted so a replaced banner shows immediately.
  const src =
    preview ?? (bannerUpdatedAt ? `${meta.proxy}/${assemblyId}?v=${bannerUpdatedAt}` : null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4" />
            {meta.title}
          </CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={meta.accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <Button
          size="sm"
          variant={src ? "outline" : "default"}
          onClick={() => inputRef.current?.click()}
          disabled={pending}
        >
          <Upload className="size-4" />
          {pending ? "Uploading…" : src ? "Replace" : "Upload image"}
        </Button>
      </CardHeader>
      <CardContent>
        {src && isVideo ? (
          <video
            src={src}
            controls
            muted
            playsInline
            className="h-40 w-full rounded-md border bg-black object-contain"
          />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={meta.title}
            className="h-40 w-full rounded-md border object-cover"
            onError={() => kind === "whatsapp" && setIsVideo(true)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{meta.empty}</p>
        )}
      </CardContent>
    </Card>
  );
}
