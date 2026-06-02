
# Plan — Extension du module Réunions

**Mode de livraison** : 1 partie par message. À la fin de chaque partie, j'attends ton OK pour passer à la suivante.

## Décisions cadres
- **Emails** : via Gmail (connecteur `google_mail`) avec fallback Outlook (`microsoft_outlook`). Si aucun n'est connecté → fallback `mailto:` + .ics téléchargeable. Aucun envoi automatique sans clic explicite (relances RSVP = bouton "Envoyer les relances", pas de cron).
- **Visio** : Google Meet créé via `conferenceData.createRequest` sur l'event GCal. Zoom/Teams = champ "coller le lien" pour l'instant. Hooks prêts pour ajouter Zoom dès que tu as les secrets.
- **Scope** : uniquement `src/components/meetings/`, `src/routes/_authenticated/meetings.tsx`, `src/routes/poll.$token.tsx` (nouveau public), `src/components/settings/meetings-section.tsx` (nouveau), `src/lib/api/meetings.functions.ts` (nouveau). On ne touche pas aux Edge Functions ni aux autres modules.
- **Architecture** : toute logique serveur sensible (Google Calendar, refresh token, calcul de créneaux, génération de liens Meet, envoi email) dans `createServerFn` avec `requireSupabaseAuth`. La page publique `/poll/$token` lit/écrit via routes serveur publiques `/api/public/poll/*` (insert vote anonyme, lecture sondage par token).

## Migrations DB à prévoir

**Phase 4** :
- `meeting_polls.confirmed_slot_id uuid` + `confirmed_at timestamptz`
- `meeting_polls.online_provider_default text`

**Phase 6** :
- Table `meeting_notes_history(id, meeting_id, user_id, content, created_at)`
- Table `meeting_shared_files(document_id, meeting_id, share_with_externals bool)` — OU plus simple, ajouter `documents.share_with_externals bool default false` filtré côté serveur (on choisira plus simple : nouvelle table de liaison pour ne PAS toucher `documents`).
- Colonne `meetings.notes_updated_at`

**Phase 7** :
- Table `meeting_settings(user_id PK, work_start_time time, work_end_time time, work_days int[], min_lead_hours int, default_provider text, default_duration_min int, email_template_invite text, email_template_confirm text)`

Pour chaque migration je te préviens avant de l'exécuter.

## Découpage des 7 phases

```text
Phase 1 — Recherche de créneaux disponibles
  • Server fn `findAvailableSlots(durationMin, days, leadHours)` qui :
    - lit les google_calendar_connections actives
    - refresh token si besoin
    - récupère freebusy via GCal API
    - applique plages 8h-19h / jours ouvrés / lead 24h (lus depuis meeting_settings si existant, sinon défauts)
    - retourne top 5 créneaux scorés (préfère 10h-12h et 14h-16h)
  • Dans meeting-dialog.tsx : bouton "🔍 Trouver des créneaux"
  • Panneau de 5 cards avec badge Matin/AM + Idéal/Disponible
  • Clic → remplit start_at / end_at

Phase 2 — Mode sondage de dates
  • Migration meeting_polls.confirmed_slot_id
  • Toggle "📊 Mode sondage" dans le dialog
  • Sélection multi-créneaux (max 10) : "Ajouter depuis mes disponibilités" (réutilise phase 1) + "Ajouter manuellement"
  • Au save : INSERT meeting_polls + meeting_poll_slots
  • Affiche le lien public copiable avec public_token

Phase 3 — Page publique /poll/$token
  • Route file-based src/routes/poll.$token.tsx (publique, hors _authenticated)
  • Server route /api/public/poll/$token (GET) → renvoie poll + slots + agrégats votes
  • Server route /api/public/poll/$token/vote (POST) → upsert meeting_poll_votes (unique slot_id+voter_email)
  • UI mobile-first : titre, organisateur, deadline, tableau créneaux × boutons Yes/Maybe/No
  • Compteur votes temps réel (revalidation après chaque vote)
  • Confirmation post-vote
  • Anti-doublon : message clair si email déjà voté + bouton "modifier ma réponse"

Phase 4 — Onglet "Résultats" dans la fiche réunion
  • Refacto meeting-dialog en Tabs : Détails / Sondage / Résultats / (Notes & Fichiers en phase 6)
  • Onglet Résultats : tableau croisé, score (yes + 0.5*maybe), gagnant en évidence, barre de progression
  • Bouton "Relancer non-répondants" → server fn qui envoie email via Gmail/Outlook
  • Bouton "✅ Choisir ce créneau" → server fn confirmPollSlot :
    - update meetings.start_at/end_at
    - close poll (status='closed', confirmed_slot_id, confirmed_at)
    - crée event GCal (avec conferenceData si provider=meet)
    - pour chaque participant : envoi email + .ics

Phase 5 — Statuts & badges
  • Sur les cards de la liste /meetings :
    - "📊 Sondage ouvert (3 votes)" si poll open lié
    - "⏰ Deadline dans Xh" si deadline < 24h
    - "✅ Confirmée" si meetings.status='scheduled' + confirmed_slot_id
    - Icône provider visio
  • Pas de cron pour les relances RSVP : un bouton "Relancer" sur la card (ouvert si J-2, J-1 ou H-2). On posera des compteurs visuels (pas d'envoi auto).

Phase 6 — Notes & Fichiers
  • Migration meeting_notes_history + table de liaison meeting_shared_files
  • Onglet "📎 Notes & Fichiers" dans le dialog
  • Éditeur : Textarea avec autosave debounce 30s → meetings.notes + insert history (1 ligne par version, max 50 conservées)
  • Drag & drop : réutilise lib documents.ts existante, source_type='meeting', source_id=meeting.id, max 25MB côté client
  • Toggle "🌐 Partager avec invités externes" par fichier → insert/delete dans meeting_shared_files (BLOQUÉ si is_sensitive=true)
  • Sur /poll/$token : section "Documents partagés" lecture seule, liens signés 7 jours via server fn
  • Checkbox "Joindre les fichiers à l'email de confirmation" dans phase 4

Phase 7 — Paramètres Réunions
  • Migration table meeting_settings
  • Nouveau composant src/components/settings/meetings-section.tsx
  • Intégré dans la page Paramètres existante (j'identifierai où)
  • Champs : horaires, jours ouvrés, lead time, provider par défaut, durée par défaut, 2 textarea pour templates email avec placeholders {{title}}, {{date}}, {{link}}, {{organizer}}
  • Hooks pour : phase 1 (slots), phase 4 (templates email), phase 2 (durée par défaut)
```

## Démarrage

Je commence par **Phase 1** dès que tu valides ce plan. Aucune migration nécessaire pour la phase 1 (lecture seule GCal).
