import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsSection } from "@/components/settings/accounts-section";
import { SyncSection } from "@/components/settings/sync-section";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { SecuritySection } from "@/components/settings/security-section";
import { DocumentsSection } from "@/components/settings/documents-section";
import { AccountSection } from "@/components/settings/account-section";
import { PlanOperationSection } from "@/components/settings/plan-operation-section";
import { BackendSection } from "@/components/settings/backend-section";
import { MeetingsSection } from "@/components/settings/meetings-section";
import { ContactsSection } from "@/components/settings/contacts-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { AiSection } from "@/components/settings/ai-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { NavigationSection } from "@/components/settings/navigation-section";



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
          <TabsTrigger value="accounts">📧 Comptes</TabsTrigger>
          <TabsTrigger value="calendars">📅 Agendas</TabsTrigger>
          <TabsTrigger value="contacts">👥 Contacts</TabsTrigger>
          <TabsTrigger value="sync">🔄 Synchronisation</TabsTrigger>
          <TabsTrigger value="integrations">🔌 Intégrations</TabsTrigger>
          <TabsTrigger value="ai">✨ IA</TabsTrigger>
          <TabsTrigger value="notifications">🔔 Notifications</TabsTrigger>
          <TabsTrigger value="meetings">🗓️ Réunions</TabsTrigger>
          <TabsTrigger value="plan">📋 Plan d'opération</TabsTrigger>
          <TabsTrigger value="documents">📁 Documents</TabsTrigger>
          <TabsTrigger value="navigation">🧭 Navigation</TabsTrigger>
          <TabsTrigger value="security">🔒 Sécurité</TabsTrigger>
          <TabsTrigger value="preferences">🎨 Apparence</TabsTrigger>
          <TabsTrigger value="advanced">⚙️ Avancé</TabsTrigger>
        </TabsList>

        <TabsContent value="account"><AccountSection /></TabsContent>
        <TabsContent value="accounts"><AccountsSection /></TabsContent>
        <TabsContent value="calendars"><SyncSection /></TabsContent>
        <TabsContent value="contacts"><ContactsSection /></TabsContent>
        <TabsContent value="sync"><SyncSection /></TabsContent>
        <TabsContent value="integrations"><IntegrationsSection /></TabsContent>
        <TabsContent value="ai"><AiSection /></TabsContent>
        <TabsContent value="notifications"><NotificationsSection /></TabsContent>
        <TabsContent value="meetings"><MeetingsSection /></TabsContent>
        <TabsContent value="plan"><PlanOperationSection /></TabsContent>
        <TabsContent value="documents"><DocumentsSection /></TabsContent>
        <TabsContent value="navigation"><NavigationSection /></TabsContent>
        <TabsContent value="security"><SecuritySection /></TabsContent>
        <TabsContent value="preferences"><PreferencesSection /></TabsContent>
        <TabsContent value="advanced"><BackendSection /></TabsContent>

      </Tabs>
    </div>
  );
}
