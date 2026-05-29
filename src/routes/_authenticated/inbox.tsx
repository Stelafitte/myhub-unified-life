import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

function InboxPage() {
  return <SectionPlaceholder title="Unified Inbox" subtitle="Boîte mail unifiée" icon={<Inbox className="h-6 w-6" />} />;
}

function SectionPlaceholder({ title, subtitle, icon }: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">À venir dans la prochaine itération.</p>
      </div>
    </div>
  );
}
