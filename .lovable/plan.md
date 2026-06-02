# Phase 11 — Quorum, salle/matériel, rappels RSVP

Périmètre strict : `meetings/`, route `/poll/$token`, Paramètres → Réunions. Aucun autre module touché.

## 1. Base de données (migration)

Nouvelles colonnes sur `meetings` :
- `equipment` text[] — matériel requis (vidéoprojecteur, micro, etc.)
- `rsvp_reminder_sent_at` timestamptz — anti-doublon pour le cron
- `rsvp_reminder_hours_before` int default 24

(les colonnes `room` et `quorum_minimum` existent déjà)

Nouvelle table `meeting_equipment_presets` (user_id, label, icon) — liste personnalisable du matériel.
GRANTs + RLS `auth.uid() = user_id` standard.

## 2. UI fiche réunion (`meeting-dialog.tsx`)

Nouvelle section **"Logistique"** au-dessus de l'agenda :
- Champ **Salle** (input texte libre + suggestions des dernières salles utilisées)
- Champ **Quorum minimum** (number, 0 = désactivé)
- Sélecteur **Matériel** (multi-checkbox à partir des presets utilisateur + bouton "+ Ajouter")
- Badge dynamique **Quorum** dans l'en-tête : `✅ Quorum atteint (5/3)` ou `⚠️ Quorum non atteint (2/3)` calculé depuis `meeting_participants.rsvp_status='yes'`

## 3. Paramètres → Réunions (`settings/meetings-section.tsx`)

Nouvelle carte **"Rappels RSVP"** :
- Heures avant la réunion (slider 1-72h, défaut 24)
- Toggle "Activer les rappels automatiques"

Nouvelle carte **"Matériel disponible"** :
- Liste éditable des presets (ajout/suppression d'items avec icône)

## 4. Cron rappels RSVP

- Route publique `src/routes/api/public/hooks/rsvp-reminders.ts`
  - Auth via `apikey` header (anon key)
  - Sélectionne les réunions à venir où :
    - `start_at` entre `now() + reminder_hours - 1h` et `now() + reminder_hours`
    - `rsvp_reminder_sent_at IS NULL`
    - participants avec `rsvp_status = 'pending'`
  - Pour chaque participant pending, log un enregistrement (table existante ou simple console.log + marqueur)
  - Met à jour `rsvp_reminder_sent_at`
- pg_cron toutes les 30 min appelant cette route

Note : l'envoi email réel passera par l'infra `send-transactional-email` si elle est déjà scaffoldée ; sinon, on prépare le hook et un template `meeting-rsvp-reminder.tsx` prêt à brancher.

## 5. Synchro temps réel

Pas de nouveau channel ; le badge quorum recalcule sur le hook existant qui charge `meeting_participants`.

## Fichiers touchés

**Créés :**
- `supabase/migrations/<ts>_meetings_phase11.sql`
- `src/components/meetings/logistics-section.tsx`
- `src/components/meetings/quorum-badge.tsx`
- `src/routes/api/public/hooks/rsvp-reminders.ts`

**Édités :**
- `src/components/meetings/meeting-dialog.tsx` (intégration LogisticsSection + QuorumBadge)
- `src/components/settings/meetings-section.tsx` (cartes Rappels RSVP + Matériel)
- `src/integrations/supabase/types.ts` (auto via migration)

**Non touché** : sync-imap, sync-gmail, autres edge functions, tous les autres modules.

Dis **« go 11 »** pour lancer.


## Phase 12 — Intégration OneNote ✅
- Connecteur Microsoft OneNote lié
- Migration: meetings.onenote_page_url, onenote_synced_at; meeting_settings.onenote_enabled, onenote_notebook_id, onenote_section_id, onenote_auto_sync
- src/lib/api/onenote.functions.ts (listNotebooks, listSections, test, syncMeetingToOneNote)
- src/components/meetings/onenote-sync-button.tsx
- Carte OneNote dans paramètres réunions (carnet/section, test connexion, auto-sync)
- Bouton sync dans le header du dialog réunion

