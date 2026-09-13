import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/hunter/HunterUI";
import { SettingsSections } from "@/components/hunter/DashboardPages";

function SettingsPage() {
  return (
    <div className="page">
      <PageHeader title="SETTINGS" subtitle="Account, integrations, trading and risk preferences" />
      <SettingsSections />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HUNTER 2X" },
      { name: "description", content: "Manage your HUNTER 2X account, integrations, trading and risk preferences." },
      { property: "og:title", content: "Settings — HUNTER 2X" },
      { property: "og:description", content: "Account, integration health, trading and risk preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});
