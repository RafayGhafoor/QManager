import { toast } from "sonner";
import type { TFunction } from "i18next";

import type { TowerActionResult } from "@/types/tower-locking";

const K = "cell_locking.tower_locking";

export type UpdateTowerSettings = (
  persist: boolean,
  failover: { enabled: boolean; threshold: number },
) => Promise<TowerActionResult>;

/**
 * One settings write, one toast, whichever control asked for it. Persist and
 * failover share a single CGI call, so both the failover tiles and the
 * keep-after-reboot toggle go through here. Returns whether the write landed.
 */
export async function writeTowerSettings(
  t: TFunction,
  update: UpdateTowerSettings,
  persist: boolean,
  failover: { enabled: boolean; threshold: number },
  successMessage: string,
): Promise<boolean> {
  const result = await update(persist, failover);
  if (!result.ok) {
    toast.error(result.error ?? t(`${K}.errors.settings_failed`));
    return false;
  }
  if (result.warning === "persist_command_failed") {
    toast.warning(t(`${K}.toast.persist_command_failed`));
    return true;
  }
  toast.success(successMessage);
  return true;
}
