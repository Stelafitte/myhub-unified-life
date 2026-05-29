import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsSection } from "@/components/settings/accounts-section";
import { SyncSection } from "@/components/settings/sync-section";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { SecuritySection } from "@/components/settings/security-section";
import { DocumentsSection } from "@/components/settings/documents-section";
import { AccountSection } from "@/components/settings/account-section";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SettingsIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
          <p className="text-sm text-muted-foreground">Comptes, synchronisation, préférences, sécurité</p>
        </div>
      </div>

      <Tabs defaultValue="account">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="account">👤 Mon compte</TabsTrigger>
          <TabsTrigger value="accounts">Comptes</TabsTrigger>
          <TabsTrigger value="sync">Synchronisation</TabsTrigger>
          <TabsTrigger value="preferences">Préférences</TabsTrigger>
          <TabsTrigger value="documents">📁 Documents</TabsTrigger>
          <TabsTrigger value="security">🔒 Sécurité & Conformité</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountSection />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsSection />
        </TabsContent>
        <TabsContent value="sync">
          <SyncSection />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesSection />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsSection />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
