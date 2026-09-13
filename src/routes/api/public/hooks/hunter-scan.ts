// Scheduled entry point for the autonomous hunting loop.
// Authenticated with the cron secret; the cycle itself is single-flight and
// bounded, so overlapping schedules are safe.
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function handle(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  const { runScannerCycle } = await import("@/lib/hunter/scanner.server");
  try {
    const report = await runScannerCycle("schedule");
    return Response.json(report, { status: report.status === "ERROR" ? 500 : 200 });
  } catch (error) {
    console.error("[hunter-scan] cycle failed", (error as Error).message);
    return Response.json({ status: "ERROR", error: (error as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/hunter-scan")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
    },
  },
});
