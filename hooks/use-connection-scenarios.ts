"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useContext,
  createContext,
  createElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  ScenarioListResponse,
  ScenarioActivateResponse,
  ScenarioApiResponse,
  ScenarioConfig,
  StoredScenario,
} from "@/types/connection-scenario";

// =============================================================================
// useConnectionScenarios — Active Scenario State, Activation & CRUD Hook
// =============================================================================
// Manages the full lifecycle: list custom scenarios, track which scenario is
// active, handle activation (AT commands), and CRUD for custom scenarios.
//
// All custom scenario definitions are stored on the modem (not localStorage)
// so they persist across browsers/devices.
//
// Backend endpoints:
//   GET  /cgi-bin/quecmanager/scenarios/list.sh      → custom scenarios + active ID
//   POST /cgi-bin/quecmanager/scenarios/activate.sh   → apply scenario
//   POST /cgi-bin/quecmanager/scenarios/save.sh       → save custom scenario
//   POST /cgi-bin/quecmanager/scenarios/delete.sh     → delete custom scenario
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/scenarios";

export interface UseConnectionScenariosReturn {
  /** Currently active scenario ID (defaults to "balanced") */
  activeScenarioId: string;
  /** Custom scenarios loaded from backend */
  customScenarios: StoredScenario[];
  /** True during initial fetch of scenarios + active state */
  isLoading: boolean;
  /** True while an activation request is in flight */
  isActivating: boolean;
  /** Error message from the last operation */
  error: string | null;
  /**
   * Activate a scenario by ID.
   * For custom scenarios, pass the config so mode + bands are sent to backend.
   * Returns success boolean.
   */
  activateScenario: (id: string, config?: ScenarioConfig) => Promise<ScenarioActionResult>;
  /**
   * Save a custom scenario definition to the backend.
   * Pass an id to update, omit id for create.
   * Returns the scenario ID on success, null on failure.
   */
  saveCustomScenario: (scenario: Omit<StoredScenario, "id"> & { id?: string }) => Promise<ScenarioSaveResult>;
  /**
   * Delete a custom scenario by ID.
   * Returns success boolean.
   */
  deleteCustomScenario: (id: string) => Promise<ScenarioActionResult>;
  /** Manually refresh all data (scenarios list + active state) */
  refresh: () => void;
}

/** Mutation outcomes; `error` is already translated and safe to toast. */
export type ScenarioActionResult = { ok: true } | { ok: false; error: string };
export type ScenarioSaveResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

const K = "scenarios.errors";

function useConnectionScenariosInternal({
  enabled,
}: {
  enabled: boolean;
}): UseConnectionScenariosReturn {
  const { t } = useTranslation("cellular");
  const [activeScenarioId, setActiveScenarioId] = useState("balanced");
  const [customScenarios, setCustomScenarios] = useState<StoredScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch scenarios list + active scenario from backend
  // ---------------------------------------------------------------------------
  const fetchScenarios = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ScenarioListResponse = await resp.json();
      if (!mountedRef.current) return;

      setCustomScenarios(data.scenarios || []);
      setActiveScenarioId(data.active_scenario_id || "balanced");
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError(t(`${K}.load_failed`));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // Initial fetch
  useEffect(() => {
    if (!enabled) return;
    fetchScenarios();
  }, [enabled, fetchScenarios]);

  // ---------------------------------------------------------------------------
  // Activate a scenario
  // ---------------------------------------------------------------------------
  const activateScenario = useCallback(
    async (id: string, config?: ScenarioConfig): Promise<ScenarioActionResult> => {
      setIsActivating(true);

      try {
        // Build POST body — default scenarios only need id,
        // custom scenarios include full config for backend to apply
        const body: Record<string, string> = { id };

        if (config && id.startsWith("custom-")) {
          body.mode = config.atModeValue;
          if (config.lte_bands) body.lte_bands = config.lte_bands;
          if (config.nsa_nr_bands) body.nsa_nr_bands = config.nsa_nr_bands;
          if (config.sa_nr_bands) body.sa_nr_bands = config.sa_nr_bands;
        }

        const resp = await authFetch(`${CGI_BASE}/activate.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioActivateResponse = await resp.json();

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, t(`${K}.activate_failed`)),
          };
        }

        // Optimistic update — backend confirmed success
        if (mountedRef.current) setActiveScenarioId(id);
        return { ok: true };
      } catch {
        return { ok: false, error: t(`${K}.activate_failed`) };
      } finally {
        if (mountedRef.current) {
          setIsActivating(false);
        }
      }
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // Save a custom scenario (create or update)
  // ---------------------------------------------------------------------------
  const saveCustomScenario = useCallback(
    async (scenario: Omit<StoredScenario, "id"> & { id?: string }): Promise<ScenarioSaveResult> => {

      try {
        const resp = await authFetch(`${CGI_BASE}/save.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scenario),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioApiResponse = await resp.json();

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, t(`${K}.save_failed`)),
          };
        }

        // Refresh the list from backend to pick up the new/updated scenario
        if (mountedRef.current) await fetchScenarios();
        return { ok: true, id: data.id || scenario.id || null };
      } catch {
        return { ok: false, error: t(`${K}.save_failed`) };
      }
    },
    [fetchScenarios, t],
  );

  // ---------------------------------------------------------------------------
  // Delete a custom scenario
  // ---------------------------------------------------------------------------
  const deleteCustomScenario = useCallback(
    async (id: string): Promise<ScenarioActionResult> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/delete.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: ScenarioApiResponse = await resp.json();

        if (!data.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, data.error, data.detail, t(`${K}.delete_failed`)),
          };
        }

        // Refresh the list from backend
        if (mountedRef.current) await fetchScenarios();
        return { ok: true };
      } catch {
        return { ok: false, error: t(`${K}.delete_failed`) };
      }
    },
    [fetchScenarios, t],
  );

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchScenarios();
  }, [fetchScenarios]);

  return {
    activeScenarioId,
    customScenarios,
    isLoading,
    isActivating,
    error,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
    refresh,
  };
}

// =============================================================================
// Optional shared instance (see SimProfilesProvider in use-sim-profiles.ts)
// =============================================================================

const ConnectionScenariosContext =
  createContext<UseConnectionScenariosReturn | null>(null);

export function ConnectionScenariosProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useConnectionScenariosInternal({ enabled: true });
  return createElement(ConnectionScenariosContext.Provider, { value }, children);
}

/** The shared instance, or `null` when no provider is mounted above. */
export function useSharedConnectionScenarios(): UseConnectionScenariosReturn | null {
  return useContext(ConnectionScenariosContext);
}

export function useConnectionScenarios(): UseConnectionScenariosReturn {
  const shared = useContext(ConnectionScenariosContext);
  const own = useConnectionScenariosInternal({ enabled: shared === null });
  return shared ?? own;
}
