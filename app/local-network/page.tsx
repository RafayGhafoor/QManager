"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Ethernet Status moved to /local-network/ethernet; this keeps old bookmarks
// working.
export default function LocalNetworkRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/local-network/ethernet");
  }, [router]);

  return null;
}
