export type SyncEntityType = "email" | "task" | "calendar" | "contact";

export type SyncSource = {
  id: string;
  label: string;
  entity: SyncEntityType;
  icon: string;
};

export const SYNC_SOURCES: SyncSource[] = [
  { id: "gmail", label: "Gmail", entity: "email", icon: "📧" },
  { id: "outlook", label: "Outlook", entity: "email", icon: "📨" },
  { id: "imap_ovh", label: "IMAP OVH", entity: "email", icon: "✉️" },
  { id: "google_calendar", label: "Google Calendar", entity: "calendar", icon: "📅" },
  { id: "icloud_calendar", label: "iCloud Calendar", entity: "calendar", icon: "🍎" },
  { id: "outlook_calendar", label: "Outlook Calendar", entity: "calendar", icon: "🗓️" },
  { id: "google_contacts", label: "Google Contacts", entity: "contact", icon: "👥" },
  { id: "icloud_contacts", label: "iCloud Contacts", entity: "contact", icon: "👤" },
  { id: "outlook_contacts", label: "Outlook Contacts", entity: "contact", icon: "🧑" },
  { id: "microsoft_todo", label: "Microsoft To Do", entity: "task", icon: "✅" },
  { id: "apple_reminders", label: "Rappels Apple", entity: "task", icon: "🔔" },
];
