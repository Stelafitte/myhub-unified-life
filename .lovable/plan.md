# Message 3 — Extensions module Réunions

Découpage en 6 phases pour valider chaque livraison. Aucun module hors `meetings/`, `/poll/[token]`, Paramètres → Réunions/Intégrations ne sera touché.

## Phase 8 — Ordre du jour structuré + mode "réunion en cours"

- Nouvel onglet **📋 Ordre du jour** dans la fiche réunion.
- Liste drag & drop (`@dnd-kit`) sur `meeting_agenda_items` : titre, durée (min), responsable (sélection parmi `meeting_participants`), statut (À traiter / En cours / Traité / Reporté).
- Total durées vs `end_at - start_at` → alerte `⚠️ Ordre du jour trop chargé`.
- Bouton **▶ Démarrer la réunion** → vue plein écran :
  - Chronomètre par point + décompte
  - Point actif surligné, bouton "Point suivant"
  - Alerte visuelle si dépassement
  - État local (pas de nouvelle table), persistance `status` à chaque transition

## Phase 9 — Actions → tâches MyHub Pro

- Sous chaque point : bouton **➕ Ajouter une action** crée :
  - une ligne `meeting_agenda_items` enfant (ou champ `parent_id` → migration légère si besoin)
  - une tâche `tasks` (`source_app='myhubpro'`, `comments` préfixé `📋 Issu de réunion : [titre]`, `assigned_to`, `due_date`)
  - lien dans `meeting_tasks`
- Onglet **Actions** dans la fiche : tableau temps réel (jointure `meeting_tasks` ↔ `tasks`), badge rouge retard, taux complétion X/Y.

## Phase 10 — Récurrence

- Migration : ajouter `recurrence_parent_id uuid` à `meetings` (les autres colonnes existent déjà).
- Formulaire : section Récurrence (Aucune / Hebdo / Bimensuelle / Mensuelle / Personnalisée) + jours + fin (date ou nb occurrences) → encodage RRULE dans `recurrence_rule`.
- Génération à la création : N occurrences avec `recurrence_parent_id` + `session_number` auto-incrémenté.
- À l'ouverture d'une occurrence : copie de l'ordre du jour précédent (points Reportés en tête).
- Onglet **🕐 Historique** : liste des sessions de la série avec liens.

## Phase 11 — Quorum, salle, matériel + relances RSVP

- Migration : ajouter `equipment text[]` à `meetings` (quorum_minimum + room déjà là).
- Formulaire : Quorum, Salle (autocomplete depuis 10 dernières `meetings.room`), Matériel (tags libres).
- Fiche : indicateur quorum atteint / non atteint (calcul côté client depuis `meeting_participants.rsvp_status`).
- **Relances** : route serveur `/api/public/cron/meeting-rsvp-reminders` + job `pg_cron` toutes les heures qui envoie J-2 / J-1 / H-2 selon `meeting_settings` (nouvelles colonnes `reminder_j2/j1/h2 boolean`).
- Settings → Réunions : 3 toggles.

## Phase 12 — OneNote via Microsoft Graph

- Migration : `onenote_settings` (user_id, notebook_id, section_id, include_agenda, include_participants), `meetings.onenote_page_url`.
- **TanStack server functions** (pas Edge Function — règle de stack) appelant Graph via le connecteur Microsoft OneNote du gateway :
  - `listNotebooks`, `listSections`, `createMeetingPage`, `syncFromOneNote`
  - Scopes `Notes.ReadWrite`, `Notes.Create` (vérif via `get_connection_configuration`, sinon `reconnect`)
- Fiche réunion : bouton **📓 Créer page OneNote** → modal sélecteur carnet/section + "mémoriser". Devient **📓 Ouvrir dans OneNote** après création. Badge 📓 sur la card.
- Bouton **🔄 Synchroniser depuis OneNote** : parse HTML du tableau Actions, propose création tâches (validation utilisateur obligatoire — jamais auto).
- Settings → Intégrations → OneNote : statut connexion, sélecteurs carnet/section par défaut, toggles template, bouton "Tester la connexion".

## Phase 13 — Polish, badges liste, QA visuelle

- Badge 📓 + indicateur quorum sur `MeetingCard`.
- Vérifs UI bout-en-bout sur les 6 phases.

## Notes techniques

- **Pas d'Edge Function** : la stack est TanStack Start → on utilise `createServerFn` + le connecteur Microsoft OneNote (gateway Lovable, token jamais côté client). Si tu veux absolument une Edge Function Supabase, dis-le, mais ça va contre la règle du template.
- `@dnd-kit/core` à installer en phase 8.
- Chaque phase = 1 migration max + code, suivie d'un "go phase X+1" de ta part avant la suivante.

---

**Confirme "go phase 8"** pour démarrer par l'ordre du jour + mode réunion en cours, ou indique-moi les ajustements (regroupement, ordre différent, Edge Function imposée pour OneNote, etc.).
