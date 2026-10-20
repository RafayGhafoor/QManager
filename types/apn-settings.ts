// =============================================================================
// apn-settings.ts — QManager APN Settings Types  (single-APN model)
// =============================================================================
// TypeScript interfaces for the single-APN model. The backend stores one
// APN setting (apn + pdp_type + cid) and the modem's live PDP contexts are
// surfaced separately so the CID picker can badge and confirm IMS/SOS slots.
//
// Backend contract:
//   CGI endpoint: /cgi-bin/quecmanager/cellular/apn.sh
//
//   GET  returns active, active_cid, internet_cid, data_cid_source, apn (stored
//        setting), cids[]
//   POST save:       { action:"save", apn, pdp_type, cid, allow_carrier_cid? }
//                    → writes + COPS cycle
//   POST deactivate: { action:"deactivate" }               → carrier default, active=0
// =============================================================================

// --- Core Types --------------------------------------------------------------

/** Carrier classification of a modem PDP context. */
export type ApnType = "" | "ims" | "emergency";

/** How the backend identified the data-bearing CID (strongest evidence first). */
export type DataCidSource = "route" | "local" | "ipv6_prefix" | "pdp" | "none";

/** The single stored APN setting. */
export interface ApnSetting {
  /** Access Point Name. */
  apn: string;
  /** PDP context type: ipv4, ipv6, ipv4v6. */
  pdp_type: string;
  /** Target modem PDP context (1-6). */
  cid: number;
}

/** A live modem PDP context — drives the CID picker badges and confirmation. */
export interface CidContext {
  /** PDP context id (1-6). */
  cid: number;
  /** Live APN string on this context ("" if undefined on the modem). */
  apn: string;
  /** Carrier classification: "" data, "ims" VoLTE, "emergency" SOS. */
  apn_type: ApnType;
  /** Whether this CID currently bears the WAN (the live Internet context). */
  is_internet: boolean;
  /** PDP activation state; null when the modem did not report it. */
  activated?: boolean | null;
}

// --- API Response Types ------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/cellular/apn.sh */
export interface ApnSettingsResponse {
  success: boolean;
  /** 1 = custom APN is live, 0 = carrier default. */
  active: number;
  /** The live data-bearing CID (the stored slot's CID when no bearer is up). */
  active_cid: number;
  /** The CID the ISP uses for data (== active_cid). */
  internet_cid: number;
  /** Evidence behind active_cid; "none" means no bearer is up. */
  data_cid_source?: DataCidSource;
  /** The stored single APN setting. Pre-fills the form even when active===0. */
  apn: ApnSetting;
  /** The modem's live PDP contexts (1-6), each tagged for the CID picker. */
  cids: CidContext[];
  error?: string;
  detail?: string;
}

/** Response from POST save / deactivate operations. */
export interface ApnSaveResponse {
  success: boolean;
  active?: number;
  error?: string;
  detail?: string;
}

// --- API Request Types -------------------------------------------------------

/** Request body for saving the APN configuration. */
export interface ApnSaveRequest {
  /** Access Point Name. */
  apn: string;
  /** PDP context type: ipv4, ipv6, ipv4v6. */
  pdp_type: string;
  /** Target modem PDP context (1-6). */
  cid: number;
  /** Set only after the user confirmed overwriting an IMS/SOS context. */
  allow_carrier_cid?: boolean;
}

// --- Display Helpers ---------------------------------------------------------

/** PDP type display options */
export const PDP_TYPE_OPTIONS = [
  { value: "ipv4", label: "IPv4" },
  { value: "ipv6", label: "IPv6" },
  { value: "ipv4v6", label: "IPv4v6" },
] as const;

/** A mutation's outcome; `error` is already resolved for display. */
export type ApnActionResult = { ok: true } | { ok: false; error: string };
