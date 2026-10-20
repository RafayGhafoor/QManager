// =============================================================================
// Custom DNS — the page draft
// =============================================================================
// One draft spans the three cards (Resolver, IPv4, IPv6) because the backend
// takes them in one POST; the Resolver card's foot commits it.
//
// While custom DNS is off, `dns.sh` reports the carrier's servers in the same
// fields, so they never seed the draft: an Off baseline is blank, and the
// address fields never pretend the carrier's resolvers are a custom choice.
// =============================================================================

import type { DnsSettingsData } from "@/hooks/use-dns-settings";

import { CUSTOM_PROVIDER_ID, DNS_PROVIDERS, matchProvider } from "./dns-providers";

export type AddressKey = "dns1" | "dns2" | "dns3" | "dns1v6" | "dns2v6";

export const V4_KEYS = ["dns1", "dns2", "dns3"] as const;
export const V6_KEYS = ["dns1v6", "dns2v6"] as const;
export const ADDRESS_KEYS: readonly AddressKey[] = [...V4_KEYS, ...V6_KEYS];

export interface Draft {
  enabled: boolean;
  dns1: string;
  dns2: string;
  dns3: string;
  dns1v6: string;
  dns2v6: string;
  /** What the provider picker shows; the addresses are what gets sent. */
  provider: string;
}

export const EMPTY_DRAFT: Draft = {
  enabled: false,
  dns1: "",
  dns2: "",
  dns3: "",
  dns1v6: "",
  dns2v6: "",
  provider: CUSTOM_PROVIDER_ID,
};

export function baselineFrom(data: DnsSettingsData): Draft {
  if (data.mode !== "enabled") return EMPTY_DRAFT;
  return {
    enabled: true,
    dns1: data.dns1,
    dns2: data.dns2,
    dns3: data.dns3,
    dns1v6: data.dns1v6,
    dns2v6: data.dns2v6,
    provider: matchProvider(data.dns1, data.dns2, data.dns3, data.dns1v6, data.dns2v6),
  };
}

/** A preset's addresses, or nothing for Custom (which keeps what is typed). */
export function presetFill(id: string): Partial<Draft> {
  const preset = DNS_PROVIDERS.find((p) => p.id === id);
  if (!preset) return { provider: CUSTOM_PROVIDER_ID };
  return {
    provider: id,
    dns1: preset.ipv4[0],
    dns2: preset.ipv4[1],
    dns3: "",
    dns1v6: preset.ipv6[0],
    dns2v6: preset.ipv6[1],
  };
}

/** Recomputes the picker after an address edit, so it never names a preset the list no longer is. */
export function providerFor(d: Pick<Draft, AddressKey>): string {
  return matchProvider(d.dns1, d.dns2, d.dns3, d.dns1v6, d.dns2v6);
}

export function hasAnyAddress(d: Pick<Draft, AddressKey>): boolean {
  return ADDRESS_KEYS.some((key) => d[key].trim() !== "");
}

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

// Structural IPv6 check, mirroring the backend's gate closely enough that a
// malformed address never reaches it.
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/** Empty is valid: every slot is optional as long as one is filled. */
export function isValidAddress(key: AddressKey, value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  return (V4_KEYS as readonly string[]).includes(key) ? IPV4.test(v) : IPV6.test(v);
}
