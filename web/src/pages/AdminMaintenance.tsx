import AdminCatalogMaintenance from "@/components/AdminCatalogMaintenance";
import AdminJobHistory from "@/components/AdminJobHistory";
import { RestartServerButton } from "@/components/admin/RestartServerButton";
import { PageHeader } from "@/components/page/PageHeader";
import { useT } from "@/i18n";

export default function AdminMaintenance() {
  const t = useT();
  return (
    <div className="space-y-6 pb-4 sm:pb-6">
      <PageHeader
        title={t("web.admin.maintenance.page.title")}
        subtitle={t("web.admin.maintenance.page.subtitleWithRestart")}
        actions={<RestartServerButton />}
      />

      <AdminCatalogMaintenance />
      <AdminJobHistory />
    </div>
  );
}
