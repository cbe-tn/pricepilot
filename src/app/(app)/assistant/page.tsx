import { AssistantChat } from "@/components/ClientWidgets";
import { PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";

export const metadata = { title: "Assistant marché" };

export default async function AssistantPage() {
  await requirePageAuth();
  return (
    <div>
      <PageHeader
        title="Assistant marché"
        subtitle="Les réponses s'appuient uniquement sur votre catalogue et les prix relevés chez les concurrents. Les données manquantes ou anciennes sont signalées — rien n'est inventé."
      />
      <AssistantChat />
    </div>
  );
}
