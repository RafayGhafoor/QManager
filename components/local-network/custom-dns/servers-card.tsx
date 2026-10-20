"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { AddressKey, Draft } from "./draft";
import {
  ADDRESS,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_ERROR,
  SETTING,
  SKELETON,
} from "./shapes";

// =============================================================================
// ServersCard — one address family's resolvers, in the order they are tried
// =============================================================================
// Two instances, IPv4 and IPv6, as peer cards. Both edit the page draft and
// have no foot: the Resolver card above applies everything. Off holds the rows
// (dimmed text, disabled fields) rather than hiding them, so turning custom DNS
// on moves nothing on the page.
// =============================================================================

const K = "dns";

const ROW_CASCADE = { variants: staggerRows, initial: "hidden", animate: "visible" } as const;

/** Literal keys rather than an interpolated suffix, so the checker can resolve them. */
const SLOT_LABEL: Record<AddressKey, string> = {
  dns1: `${K}.rows.primary`,
  dns2: `${K}.rows.secondary`,
  dns3: `${K}.rows.tertiary`,
  dns1v6: `${K}.rows.primary`,
  dns2v6: `${K}.rows.secondary`,
};

const PLACEHOLDER: Record<AddressKey, string> = {
  dns1: `${K}.placeholder_primary_dns`,
  dns2: `${K}.placeholder_secondary_dns`,
  dns3: `${K}.placeholder_tertiary_dns`,
  dns1v6: `${K}.placeholder_primary_dns6`,
  dns2v6: `${K}.placeholder_secondary_dns6`,
};

const FAMILY = {
  v4: {
    title: `${K}.cards.ipv4.title`,
    description: `${K}.cards.ipv4.description`,
    error: `${K}.error_invalid_ipv4`,
    width: ADDRESS.V4,
    inputMode: "decimal",
  },
  v6: {
    title: `${K}.cards.ipv6.title`,
    description: `${K}.cards.ipv6.description`,
    error: `${K}.error_invalid_ipv6`,
    width: ADDRESS.V6,
    inputMode: "text",
  },
} as const;

export interface ServersCardProps {
  family: keyof typeof FAMILY;
  keys: readonly AddressKey[];
  pending: boolean;
  /** The Resolver card's form, which these fields submit. */
  formId: string;
  draft: Draft;
  invalid: Record<AddressKey, boolean>;
  held: boolean;
  onChange: (key: AddressKey, value: string) => void;
}

export function ServersCard({
  family,
  keys,
  pending,
  formId,
  draft,
  invalid,
  held,
  onChange,
}: ServersCardProps) {
  const { t } = useTranslation("local-network");
  const baseId = React.useId();
  const errorId = `${baseId}-error`;
  const spec = FAMILY[family];
  const familyInvalid = keys.some((key) => invalid[key]);

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(spec.title)}</CardTitle>
        <CardDescription className={CARD_DESC}>{t(spec.description)}</CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        {pending ? (
          <div className={SETTING.GROUP} aria-hidden="true">
            {keys.map((key) => (
              <div key={key} className={SETTING.ROW}>
                <Skeleton className={SKELETON.ROW_KEY} />
                <Skeleton className={cn(SKELETON.FIELD, "ml-auto", spec.width)} />
              </div>
            ))}
          </div>
        ) : (
          <motion.div className={SETTING.GROUP} {...ROW_CASCADE}>
            {keys.map((key) => {
              const id = `${baseId}-${key}`;
              return (
                <motion.div key={key} variants={staggerRowItem} className={SETTING.ROW}>
                  <div className={cn(SETTING.KEY_SLOT, held && SETTING.HELD)}>
                    <label htmlFor={id} className={SETTING.KEY_LINE}>
                      {t(SLOT_LABEL[key])}
                    </label>
                  </div>
                  <div className={cn(SETTING.CONTROL, spec.width)}>
                    <Input
                      id={id}
                      form={formId}
                      value={draft[key]}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={held}
                      inputMode={spec.inputMode}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={t(PLACEHOLDER[key])}
                      aria-invalid={invalid[key] || undefined}
                      aria-describedby={invalid[key] ? errorId : undefined}
                      className={cn(ADDRESS.INPUT, invalid[key] && ADDRESS.INVALID)}
                    />
                  </div>
                </motion.div>
              );
            })}
            {familyInvalid ? (
              <p id={errorId} role="alert" className={FIELD_ERROR}>
                {t(spec.error)}
              </p>
            ) : null}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

export default ServersCard;
