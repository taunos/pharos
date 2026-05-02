import { redirect } from "next/navigation";

// Slice A2 — Publishing Bundle. Hub stub at top-level /methodology.
//
// Reserved for a future methodology hub once additional methodology
// surfaces exist. Until then, this page redirects to the only current
// methodology surface (calibration record). Avoids 404 for users guessing
// the bare /methodology URL.

export default function MethodologyHubStub() {
  redirect("/methodology/calibration");
}
