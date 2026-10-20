import { toast } from "sonner";
import type { TFunction } from "i18next";

import type {
  TowerActionResult,
  TowerSettingsChange,
} from "@/types/tower-locking";

const K = "cell_locking.tower_locking";

export type UpdateTowerSettings = (
  change: TowerSettingsChange,
) => Promise<TowerActionResult>;

/**
 * One settings write, one toast, whichever control asked for it. Failover and
 * each radio's keep-after-reboot go through the same CGI call. Returns whether
 * the write landed (a rejected `save_ctrl` warns and counts as not landed).
 */
export async function writeTowerSettings(
  t: TFunction,
  update: UpdateTowerSettings,
  change: TowerSettingsChange,
  successMessage: string,
): Promise<boolean> {
  const result = await update(change);
  if (!result.ok) {
    toast.error(result.error ?? t(`${K}.errors.settings_failed`));
    return false;
  }
  if (result.warning === "persist_command_failed") {
    toast.warning(t(`${K}.toast.persist_command_failed`));
    return false;
  }
  toast.success(successMessage);
  return true;
}
