// =============================================================================
// data-used.ts: types for the storage CGI
// =============================================================================
// Mirrors system/storage.sh (docs/features/data-used.md). The Data Used
// counter types were removed with its dashboard row; the feature is parked.
// =============================================================================

/** GET system/storage.sh */
export interface StorageResponse {
  success: boolean;
  storage: {
    mount: string;
    total_kb: number;
    used_kb: number;
    available_kb: number;
  } | null;
}
