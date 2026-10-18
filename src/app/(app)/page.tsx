import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export default function DashboardPage() {
  return (
    <>
      <PageHeader eyebrow="Tableau de bord" title="Ta journée de recherche" />
      <EmptyState title="Aucune donnée pour l'instant">
        <p>Les indicateurs apparaîtront dès que tu auras importé ton CV et tes premières offres.</p>
      </EmptyState>
    </>
  );
}
