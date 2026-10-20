"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { motion } from "motion/react";

import { useMotionReduced } from "@/components/motion-preference";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { PATH } from "../shapes";

// =============================================================================
// Path diagram: the Hardware pair's status, drawn as a flow
// =============================================================================
// Icons joined by lines, read left to right: what sends, the two ways it can
// go, what receives. Green is spent only on the discs in play; lines stay ink.
// The lane in play gets the stronger line and an arrowhead, and while the
// picture shows what is really running, beads flow along it toward the
// destination (`animate-path-flow`, the third sanctioned loop in DESIGN.md >
// The One-Loop Rule). A draft or a pending reboot draws the same picture still.
// A shut lane carries an X on its line. State never rides on colour alone.
//
// One end may be a lone node that forks into (or merges out of) both lanes; the
// other may be a pair, one node per lane. It is the card's one inner container,
// so it rides on the ROW_GROUP rather than wrapping itself in a tile.
// =============================================================================

export interface PathNode {
  key: string;
  icon: LucideIcon;
  label: string;
  /** In play: the disc turns green and the name takes full ink. */
  lit: boolean;
}

export interface PathLane extends PathNode {
  /** The lane is closed: an X sits on the line leading into it. */
  shut?: boolean;
}

interface PathDiagramProps {
  /** The eyebrow, with its HintIcon beside it. */
  eyebrow: string;
  hint: ReactNode;
  /** The head's trailing slot: Preview while a draft is drawn, or a pending chip. */
  trailing?: ReactNode;
  /** One node forks into both lanes; two feed a lane each. */
  sources: PathNode[];
  /** The two lanes, top and bottom. Their `lit` drives the lines. */
  lanes: [PathLane, PathLane];
  /** One node merges both lanes; two take a lane each. */
  sinks: PathNode[];
  /**
   * The picture is what is actually running, so lit lanes flow. False for a
   * draft (Preview) or a state waiting on a reboot: drawn, but still.
   */
  live: boolean;
  /** What the picture says, for a screen reader. */
  ariaLabel: string;
}

const COL = ["col-start-1", "col-start-2", "col-start-3", "col-start-4", "col-start-5"] as const;
const ROW = ["row-start-1", "row-start-2"] as const;

/** Two beads per line, half a cycle apart, so the stream reads as continuous. */
const BEAD_DELAYS = ["0s", "calc(var(--duration-ambient) / -2)"] as const;

function Node({
  node,
  lone,
  quiet = false,
}: {
  node: PathNode;
  lone: boolean;
  quiet?: boolean;
}) {
  const Icon = node.icon;
  return (
    <>
      <span
        className={cn(
          PATH.DISC,
          lone && PATH.DISC_LONE,
          node.lit ? PATH.DISC_LIT : PATH.DISC_REST,
        )}
      >
        <Icon className={lone ? PATH.GLYPH_LONE : PATH.GLYPH} />
      </span>
      <span
        className={cn(
          PATH.LABEL,
          node.lit ? PATH.LABEL_LIT : PATH.LABEL_REST,
          quiet && PATH.LABEL_QUIET,
        )}
      >
        {node.label}
      </span>
    </>
  );
}

function Line({
  lit,
  flow,
  arrow,
  shut,
  className,
}: {
  lit: boolean;
  /** Beads travel this line (only ever on a lit, live line). */
  flow?: boolean;
  arrow?: boolean;
  shut?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(PATH.LINE, lit ? PATH.LINE_LIT : PATH.LINE_REST, className)}>
      {flow
        ? BEAD_DELAYS.map((delay) => (
            <span key={delay} className={PATH.FLOW} style={{ animationDelay: delay }}>
              <span className={PATH.BEAD} />
            </span>
          ))
        : null}
      {arrow ? (
        <span className={cn(PATH.ARROW, lit ? PATH.ARROW_LIT : PATH.ARROW_REST)} />
      ) : null}
      {shut ? (
        <span className={PATH.SHUT}>
          <XIcon className={PATH.SHUT_GLYPH} strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  );
}

/** A joint that splits one line into two lanes (`fork`) or folds two into one (`merge`). */
function Joint({
  kind,
  lit,
  live,
}: {
  kind: "fork" | "merge";
  lit: readonly [boolean, boolean];
  live: boolean;
}) {
  const fork = kind === "fork";
  // The bus sits 40% in from the lone end, so the lanes get the longer run.
  const bus = fork ? "left-[40%]" : "left-[60%]";
  const lane = fork ? "left-[40%] right-0" : "left-0 right-[40%]";
  const stub = fork ? "left-0 w-[40%]" : "right-0 w-[40%]";
  const either = lit[0] || lit[1];
  return (
    <>
      <Line
        lit={either}
        flow={live && either}
        arrow={!fork}
        className={cn("absolute top-1/2 -translate-y-px", stub)}
      />
      {[0, 1].map((i) => (
        <span key={i}>
          <span
            className={cn(
              PATH.BUS,
              bus,
              i === 0 ? "top-1/4" : "top-1/2",
              lit[i] ? PATH.LINE_LIT : PATH.LINE_REST,
            )}
          />
          <Line
            lit={lit[i]}
            flow={live && lit[i]}
            arrow={fork}
            className={cn("absolute -translate-y-px", lane, i === 0 ? "top-1/4" : "top-3/4")}
          />
        </span>
      ))}
    </>
  );
}

export function PathDiagram({
  eyebrow,
  hint,
  trailing,
  sources,
  lanes,
  sinks,
  live,
  ariaLabel,
}: PathDiagramProps) {
  const reduce = useMotionReduced();
  const lit = [lanes[0].lit, lanes[1].lit] as const;

  // Left to right, the nodes arrive first and the line after them draws on.
  // Enter only; under Reduced, movement goes and opacity stays.
  const nodeIn = (col: number) => ({
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: DUR.standard, ease: EASE_STANDARD, delay: rowCascadeDelay(col) },
  });
  const lineIn = (col: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, clipPath: "inset(-12px 100% -12px 0)" },
    animate: reduce ? { opacity: 1 } : { opacity: 1, clipPath: "inset(-12px -12px -12px 0)" },
    transition: { duration: DUR.standard, ease: EASE_STANDARD, delay: rowCascadeDelay(col) },
  });

  const lone = (n: PathNode[]) => n.length === 1;
  // With a named pair feeding the lanes, each route is already named by its
  // ends, so the lanes' names are the ones a narrow card can spare.
  const quietLanes = !lone(sources);

  return (
    <div className={PATH.ROOT}>
      <div className={PATH.HEAD}>
        <span className={PATH.EYEBROW}>
          {eyebrow}
          {hint}
        </span>
        {trailing}
      </div>
      <div role="img" aria-label={ariaLabel} className={PATH.FIELD}>
        {/* Sources */}
        {sources.map((n, i) => (
          <motion.div
            key={n.key}
            {...nodeIn(0)}
            className={cn(COL[0], lone(sources) ? ROW[0] : ROW[i], lone(sources) ? PATH.STACK : PATH.INLINE)}
            aria-hidden="true"
          >
            <Node node={n} lone={lone(sources)} />
          </motion.div>
        ))}

        {/* Sources to lanes */}
        {lone(sources) ? (
          <motion.div {...lineIn(1)} className={cn(COL[1], ROW[0], PATH.JOINT)} aria-hidden="true">
            <Joint kind="fork" lit={lit} live={live} />
          </motion.div>
        ) : (
          lanes.map((l, i) => (
            <motion.div key={i} {...lineIn(1)} className={cn(COL[1], ROW[i], PATH.LANE)} aria-hidden="true">
              <Line lit={lit[i]} flow={live && lit[i]} arrow={!l.shut} shut={l.shut} />
            </motion.div>
          ))
        )}

        {/* Lanes */}
        {lanes.map((n, i) => (
          <motion.div key={n.key} {...nodeIn(2)} className={cn(COL[2], ROW[i], PATH.INLINE)} aria-hidden="true">
            <Node node={n} lone={false} quiet={quietLanes} />
          </motion.div>
        ))}

        {/* Lanes to sinks */}
        {lone(sinks) ? (
          <motion.div {...lineIn(3)} className={cn(COL[3], ROW[0], PATH.JOINT)} aria-hidden="true">
            <Joint kind="merge" lit={lit} live={live} />
          </motion.div>
        ) : (
          lanes.map((_, i) => (
            <motion.div key={i} {...lineIn(3)} className={cn(COL[3], ROW[i], PATH.LANE)} aria-hidden="true">
              <Line lit={lit[i]} flow={live && lit[i]} arrow />
            </motion.div>
          ))
        )}

        {/* Sinks */}
        {sinks.map((n, i) => (
          <motion.div
            key={n.key}
            {...nodeIn(4)}
            className={cn(COL[4], lone(sinks) ? ROW[0] : ROW[i], lone(sinks) ? PATH.STACK : PATH.INLINE)}
            aria-hidden="true"
          >
            <Node node={n} lone={lone(sinks)} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
