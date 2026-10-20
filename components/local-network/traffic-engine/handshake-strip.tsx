"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useMotionReduced } from "@/components/motion-preference";
import { Tag } from "@/components/ui/tag";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { STRIP } from "./shapes";

/** The real hostnames the diagram names. Illustrative: the strip draws one flow. */
const SAMPLE_VIDEO_HOST = "googlevideo.com";
const SAMPLE_REAL_HOST = "youtube.com";

interface Block {
  key: string;
  kind: "fragment" | "decoy" | "real";
  /** The carrier reads this block. Promoted while the mode runs. */
  read: boolean;
  title: string;
  mono?: string;
}

interface HandshakeStripProps {
  mode: "video" | "masquerade";
  /** The mode owns the engine: the read blocks light up. */
  active: boolean;
  /** Video Optimizer: one fragment per strength step. */
  strength: number;
  /** Masquerade: the disguise the decoys name. */
  domain: string;
  /** The strip draws an unapplied draft. */
  preview: boolean;
  /** The eyebrow's HintIcon. */
  hint: ReactNode;
}

/**
 * What the carrier's DPI reads off one handshake, drawn left to right in send
 * order. Video Optimizer is one-byte fragments then the rest, so the hostname
 * never arrives whole; Masquerade is two decoys naming the disguise, then the
 * real handshake. The card's one inner container.
 */
export function HandshakeStrip({
  mode,
  active,
  strength,
  domain,
  preview,
  hint,
}: HandshakeStripProps) {
  const { t } = useTranslation("local-network");
  const reduce = useMotionReduced();
  const sni = (host: string) => t("traffic_engine.strip_sni", { domain: host });

  const blocks: Block[] =
    mode === "video"
      ? [
          ...Array.from({ length: strength }, (_, i) => ({
            key: `f${i}`,
            kind: "fragment" as const,
            read: true,
            title: t("traffic_engine.strip_fragment"),
          })),
          {
            key: "rest",
            kind: "real",
            read: false,
            title: t("traffic_engine.strip_rest"),
            mono: sni(SAMPLE_VIDEO_HOST),
          },
        ]
      : [
          { key: "d0", kind: "decoy", read: true, title: t("traffic_engine.strip_decoy"), mono: sni(domain) },
          { key: "d1", kind: "decoy", read: true, title: t("traffic_engine.strip_decoy"), mono: sni(domain) },
          {
            key: "real",
            kind: "real",
            read: false,
            title: t("traffic_engine.strip_real"),
            mono: sni(SAMPLE_REAL_HOST),
          },
        ];

  const label =
    mode === "video"
      ? t("traffic_engine.strip_aria_video", { count: strength })
      : t("traffic_engine.strip_aria_masquerade", { domain });

  return (
    <div className={STRIP.TILE}>
      <div className={STRIP.HEAD}>
        <span className={STRIP.EYEBROW}>
          {t("traffic_engine.strip_eyebrow")}
          {hint}
        </span>
        {preview ? <Tag>{t("traffic_engine.strip_preview")}</Tag> : null}
      </div>
      {/* Keyed on the running state so the blocks grow in again when the mode
          takes over; a strength step only adds or drops its own fragment. */}
      <div key={active ? "on" : "off"} role="img" aria-label={label} className={STRIP.ROW}>
        {blocks.map((b, i) => (
          <motion.div
            key={b.key}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scaleX: 0.4 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{
              duration: DUR.standard,
              ease: EASE_STANDARD,
              delay: rowCascadeDelay(i),
            }}
            className={cn(
              STRIP.BLOCK,
              b.kind === "fragment" ? STRIP.FRAGMENT : b.kind === "decoy" ? STRIP.DECOY : STRIP.REAL,
              active && b.read ? STRIP.BLOCK_READ : STRIP.BLOCK_REST,
            )}
          >
            <span className={b.kind === "fragment" ? STRIP.FRAGMENT_TITLE : STRIP.TITLE}>
              {b.title}
            </span>
            {b.mono ? <span className={STRIP.MONO}>{b.mono}</span> : null}
          </motion.div>
        ))}
      </div>
      <div className={STRIP.AXIS} aria-hidden="true">
        <span>{t("traffic_engine.strip_axis_first")}</span>
        <span className={STRIP.AXIS_RULE}>
          <span className={STRIP.AXIS_HEAD} />
        </span>
        <span>{t("traffic_engine.strip_axis_last")}</span>
      </div>
    </div>
  );
}
