"use client";

import { useEffect, useState } from "react";
import { isLoggedIn } from "@/hooks/use-auth";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { Spinner } from "@/components/ui/spinner";

// =============================================================================
// /setup — First-time onboarding wizard route
// =============================================================================
// Guards:
//   - Already logged in + onboarding completed → redirect /dashboard/
//   - setup_required is false (password already set, not logged in) → /login/
// Renders OnboardingWizard when setup_required is confirmed.
// =============================================================================

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";
const CHECK_ATTEMPTS = 3;
const CHECK_RETRY_MS = 1500;

export default function SetupPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Guard 1: already logged in
    if (isLoggedIn()) {
      window.location.href = "/dashboard/";
      return;
    }

    // Guard 2: confirm setup_required via backend. On first boot the web
    // server can answer before the CGI backend is ready, so a failed check is
    // retried before giving up (RM520N fork 7893a5a5). After the retries the
    // login page is the fallback, as before: it is the safe default on a
    // device whose password may already be set.
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const checkSetup = () => {
      fetch(CHECK_ENDPOINT)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (!data.setup_required) {
            // Password already set — go to normal login
            window.location.href = "/login/";
            return;
          }
          setReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt < CHECK_ATTEMPTS) {
            timer = window.setTimeout(checkSetup, CHECK_RETRY_MS);
          } else {
            window.location.href = "/login/";
          }
        });
    };

    checkSetup();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-on-surface-variant" />
      </div>
    );
  }

  return <OnboardingWizard />;
}
