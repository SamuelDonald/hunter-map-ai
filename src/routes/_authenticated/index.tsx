import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/components/hunter/DashboardPages";

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/_authenticated/")({ head: () => ({ meta: [{ title: "Overview — HUNTER 2X" }, { name: "description", content: "Demo Solana opportunity intelligence overview." }, { property: "og:title", content: "Overview — HUNTER 2X" }, { property: "og:description", content: "Explore a demo crypto intelligence bubble map and paper portfolio." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }), component: OverviewPage });
