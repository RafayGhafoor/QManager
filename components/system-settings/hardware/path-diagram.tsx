"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
// Nodes joined by routes, read left to right: what sends, the two ways it can
// go, what receives. The nodes are laid out by the grid; the routes are one SVG
// under them, measured from where the nodes actually landed, so a line always
// meets a node's edge whatever the label length or locale.
//
// A lone end forks into (or merges out of) both lanes through one trunk on
// rounded elbows, so a merge lands on its sink with a single arrow. Green is
// spent only on the discs in play and the beads; lines stay ink, and the route
// in play is drawn over the resting one. While the picture shows what is really
// running, beads travel each route in play from its source to its sink, passing
// under every node on the way (`animate-path-flow`, the third sanctioned loop in
// DESIGN.md > The One-Loop Rule). A draft or a pending reboot draws the same
// picture still. A shut lane carries an X on its line. State never rides on
// colour alone.
//
// It is the card's one inner container, so it rides on the ROW_GROUP rather
// than wrapping itself in a tile.
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
  /** The two lanes, top and bottom. Their `lit` drives the routes. */
  lanes: [PathLane, PathLane];
  /** One node merges both lanes; two take a lane each. */
  sinks: PathNode[];
  /**
   * The picture is what is actually running, so lit routes flow. False for a
   * draft (Preview) or a state waiting on a reboot: drawn, but still.
   */
  live: boolean;
  /** What the picture says, for a screen reader. */
  ariaLabel: string;
}

const COL = ["col-start-1", "col-start-3", "col-start-5"] as const;
const ROW = ["row-start-1", "row-start-2"] as const;

// Route geometry, in px.
/** Air between a line's end and the node it meets. */
const GAP = 6;
/** Corner radius of an elbow. */
const RADIUS = 10;
/** Half the height of an arrowhead; it is as deep as it is half-tall. */
const HEAD = 4;
/** Where a fork bends, as a share of the run from the lone source. */
const FORK_AT = 0.42;
/** Where a merge bends, as a share of the run from the lanes. */
const MERGE_AT = 0.58;

interface Box {
  l: number;
  r: number;
  cx: number;
  cy: number;
}

interface Geometry {
  w: number;
  h: number;
  boxes: Record<string, Box>;
}

/**
 * A run from (x0, y0) to (x1, y1) that changes lanes at `xb` on two rounded
 * corners. `move` false continues the current subpath instead of starting one.
 */
function elbow(x0: number, y0: number, x1: number, y1: number, xb: number, move = true): string {
  const head = move ? `M ${x0} ${y0} ` : "";
  const dy = y1 - y0;
  if (Math.abs(dy) < 0.5) return `${head}H ${x1}`;
  const s = Math.sign(dy);
  const r = Math.max(0, Math.min(RADIUS, Math.abs(dy) / 2, xb - x0, x1 - xb));
  // Right then down turns clockwise (sweep 1); down then right turns back.
  const a = s > 0 ? 1 : 0;
  const b = s > 0 ? 0 : 1;
  return (
    `${head}H ${xb - r} A ${r} ${r} 0 0 ${a} ${xb} ${y0 + s * r} ` +
    `V ${y1 - s * r} A ${r} ${r} 0 0 ${b} ${xb + r} ${y1} H ${x1}`
  );
}

/** An open chevron whose tip sits on (x, y), pointing right. */
function arrowhead(x: number, y: number): string {
  return `M ${x - HEAD} ${y - HEAD} L ${x} ${y} L ${x - HEAD} ${y + HEAD}`;
}

interface Route {
  lane: number;
  lit: boolean;
  /** The visible strokes: source to lane, lane to sink, with their arrowheads. */
  strokes: string;
  /** The whole journey, centre to centre, that the beads ride. */
  journey: string;
  /** Where a shut lane's X sits. */
  shutAt?: { x: number; y: number };
}

function plotRoutes(
  geo: Geometry,
  sourceKeys: string[],
  lanes: [PathLane, PathLane],
  sinkKeys: string[],
): Route[] | null {
  const box = (k: string) => geo.boxes[k];
  const laneBoxes = lanes.map((l) => box(`lane:${l.key}`));
  const srcBoxes = sourceKeys.map((k) => box(`source:${k}`));
  const sinkBoxes = sinkKeys.map((k) => box(`sink:${k}`));
  if ([...laneBoxes, ...srcBoxes, ...sinkBoxes].some((b) => !b)) return null;

  // One bend column per joint, shared by both lanes, so the trunk is one line.
  const minLaneL = Math.min(...laneBoxes.map((b) => b.l));
  const maxLaneR = Math.max(...laneBoxes.map((b) => b.r));
  const forkX =
    srcBoxes.length === 1
      ? srcBoxes[0].r + GAP + (minLaneL - srcBoxes[0].r - 2 * GAP) * FORK_AT
      : 0;
  const mergeX =
    sinkBoxes.length === 1
      ? maxLaneR + GAP + (sinkBoxes[0].l - maxLaneR - 2 * GAP) * MERGE_AT
      : 0;

  return lanes.map((lane, i) => {
    const src = srcBoxes.length === 1 ? srcBoxes[0] : srcBoxes[i];
    const sink = sinkBoxes.length === 1 ? sinkBoxes[0] : sinkBoxes[i];
    const mid = laneBoxes[i];

    const inX = mid.l - GAP;
    const outX = sink.l - GAP;
    const strokes = [
      elbow(src.r + GAP, src.cy, inX, mid.cy, forkX),
      lane.shut ? "" : arrowhead(inX, mid.cy),
      elbow(mid.r + GAP, mid.cy, outX, sink.cy, mergeX),
      arrowhead(outX, sink.cy),
    ].join(" ");

    const journey =
      elbow(src.cx, src.cy, mid.cx, mid.cy, forkX) +
      " " +
      elbow(mid.cx, mid.cy, sink.cx, sink.cy, mergeX, false);

    // On a fork the X sits on the lane's own leg, past the bend.
    const shutX = srcBoxes.length === 1 ? (forkX + inX) / 2 : (src.r + inX) / 2;
    return {
      lane: i,
      lit: lane.lit,
      strokes,
      journey,
      shutAt: lane.shut ? { x: shutX, y: mid.cy } : undefined,
    };
  });
}

function sameGeometry(a: Geometry | null, b: Geometry): boolean {
  if (!a || a.w !== b.w || a.h !== b.h) return false;
  const keys = Object.keys(b.boxes);
  if (keys.length !== Object.keys(a.boxes).length) return false;
  return keys.every((k) => {
    const p = a.boxes[k];
    const q = b.boxes[k];
    return p && p.l === q.l && p.r === q.r && p.cy === q.cy;
  });
}

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
        data-path-anchor={lone ? "" : undefined}
        className={cn(
          PATH.DISC,
          lone && PATH.DISC_LONE,
          node.lit ? PATH.DISC_LIT : lone ? PATH.DISC_REST : PATH.DISC_REST_CHIP,
        )}
      >
        <Icon className={lone ? PATH.GLYPH_LONE : PATH.GLYPH} />
      </span>
      <span
        className={cn(
          PATH.LABEL,
          !lone && PATH.LABEL_CHIP,
          node.lit ? PATH.LABEL_LIT : PATH.LABEL_REST,
          quiet && PATH.LABEL_QUIET,
        )}
      >
        {node.label}
      </span>
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);

  const lone = (n: PathNode[]) => n.length === 1;
  // With a named pair feeding the lanes, each route is already named by its
  // ends, so the lanes' names are the ones a narrow card can spare.
  const quietLanes = !lone(sources);

  // Measure where every node landed, relative to the field. A lone end's anchor
  // is its disc (the name hangs below it); a chip's anchor is the whole pill.
  const measure = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    const f = field.getBoundingClientRect();
    const boxes: Record<string, Box> = {};
    field.querySelectorAll<HTMLElement>("[data-path-node]").forEach((el) => {
      const anchor = el.querySelector<HTMLElement>("[data-path-anchor]") ?? el;
      const b = anchor.getBoundingClientRect();
      const round = (v: number) => Math.round(v * 2) / 2;
      boxes[el.dataset.pathNode as string] = {
        l: round(b.left - f.left),
        r: round(b.right - f.left),
        cx: round(b.left - f.left + b.width / 2),
        cy: round(b.top - f.top + b.height / 2),
      };
    });
    const next = { w: Math.round(f.width), h: Math.round(f.height), boxes };
    setGeo((prev) => (sameGeometry(prev, next) ? prev : next));
  }, []);

  // Any node changing width (a label, a locale, a narrow card dropping a name)
  // moves the routes, so every node is watched, not just the field.
  const nodeSignature = [...sources, ...lanes, ...sinks]
    .map((n) => `${n.key}:${n.label}`)
    .join("|");
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(field);
    field.querySelectorAll("[data-path-node]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measure, nodeSignature, quietLanes]);

  const routes = geo
    ? plotRoutes(
        geo,
        sources.map((n) => n.key),
        lanes,
        sinks.map((n) => n.key),
      )
    : null;
  // The route in play is drawn last, so it owns a trunk the two routes share.
  const ordered = routes ? [...routes].sort((a, b) => Number(a.lit) - Number(b.lit)) : [];
  const flowing = live && !reduce ? ordered.filter((r) => r.lit) : [];

  // Left to right, the nodes arrive first and the routes draw on after them.
  // Enter only; under Reduced, movement goes and opacity stays.
  const nodeIn = (step: number) => ({
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: DUR.standard, ease: EASE_STANDARD, delay: rowCascadeDelay(step) },
  });
  const routesIn = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, clipPath: "inset(-12px 100% -12px 0)" },
    animate: reduce ? { opacity: 1 } : { opacity: 1, clipPath: "inset(-12px -12px -12px 0)" },
    transition: { duration: DUR.standard, ease: EASE_STANDARD, delay: rowCascadeDelay(1) },
  };

  const place = (ends: PathNode[], i: number, col: string) =>
    cn(col, lone(ends) ? ROW[0] : ROW[i], lone(ends) ? PATH.STACK : PATH.CHIP);

  return (
    <div className={PATH.ROOT}>
      <div className={PATH.HEAD}>
        <span className={PATH.EYEBROW}>
          {eyebrow}
          {hint}
        </span>
        {trailing}
      </div>
      <div ref={fieldRef} role="img" aria-label={ariaLabel} className={PATH.FIELD}>
        {routes ? (
          <motion.svg
            {...routesIn}
            className={PATH.ROUTES}
            viewBox={`0 0 ${geo?.w ?? 0} ${geo?.h ?? 0}`}
            aria-hidden="true"
          >
            {ordered.map((r) => (
              <path
                key={`line-${r.lane}`}
                d={r.strokes}
                className={cn(PATH.LINE, r.lit ? PATH.LINE_LIT : PATH.LINE_REST)}
              />
            ))}
            {flowing.map((r) => (
              <path key={`beads-${r.lane}`} d={r.journey} pathLength={100} className={PATH.BEADS} />
            ))}
          </motion.svg>
        ) : null}

        {routes?.map((r) =>
          r.shutAt ? (
            <span
              key={`shut-${r.lane}`}
              className={PATH.SHUT}
              style={{ left: r.shutAt.x, top: r.shutAt.y }}
              aria-hidden="true"
            >
              <XIcon className={PATH.SHUT_GLYPH} strokeWidth={2.5} />
            </span>
          ) : null,
        )}

        {sources.map((n, i) => (
          <motion.div
            key={n.key}
            {...nodeIn(0)}
            data-path-node={`source:${n.key}`}
            className={place(sources, i, COL[0])}
            aria-hidden="true"
          >
            <Node node={n} lone={lone(sources)} />
          </motion.div>
        ))}

        {lanes.map((n, i) => (
          <motion.div
            key={n.key}
            {...nodeIn(2)}
            data-path-node={`lane:${n.key}`}
            className={cn(COL[1], ROW[i], PATH.CHIP)}
            aria-hidden="true"
          >
            <Node node={n} lone={false} quiet={quietLanes} />
          </motion.div>
        ))}

        {sinks.map((n, i) => (
          <motion.div
            key={n.key}
            {...nodeIn(4)}
            data-path-node={`sink:${n.key}`}
            className={place(sinks, i, COL[2])}
            aria-hidden="true"
          >
            <Node node={n} lone={lone(sinks)} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
