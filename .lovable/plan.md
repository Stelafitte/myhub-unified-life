## Objectif

Brancher un 2e agenda Google (`Agenda_SL perso non pro`) à côté de l'agenda Pro déjà connecté, avec :
- superposition visuelle (Pro = indigo, Perso = orange)
- sélecteur Pro/Perso partout où on crée un événement / une réunion (défaut = Pro)
- toutes les recherches/freebusy interrogent les 2 agendas
- synchro bidirectionnelle des 2

## Décision d'archi (Option A retenue)

Réutiliser la table `google_calendar_connections` existante : 1 ligne = 1 agenda Google. On ajoutera une 2e ligne pour l'agenda Perso, avec le même `refresh_token` que la connexion Pro mais un `calendar_id` différent.

Petite migration nécessaire pour porter la notion Pro/Perso au niveau connexion (et non plus seulement au niveau événement) :

- `google_calendar_connections.category` (`text`, défaut `'pro'`) — Pro ou Perso
- `google_calendar_connections.color` (`text`, nullable) — pour la couleur d'affichage

Aucune nouvelle table, aucune RLS à changer.

## Étapes

### 1. Migration SQL
Ajout des 2 colonnes ci-dessus sur `google_calendar_connections`. Backfill : ligne existante → `category='pro'`, `color='#6366f1'` (indigo).

### 2. Serveur — nouvelles server functions (`src/lib/api/google-calendar.functions.ts`)
- `listGoogleCalendars(connectionId)` → appelle `calendarList` de Google pour lister les agendas disponibles dans le compte connecté. Permet à l'UI de proposer "Agenda_SL perso non pro" dans une liste déroulante.
- `addGoogleCalendarFromExisting({ sourceConnectionId, calendarId, label, category, color })` → insère une nouvelle ligne dans `google_calendar_connections` qui réutilise le `refresh_token` + `access_token` + `expires_at` de la connexion source, mais avec `calendar_id` distinct. Bidirectionnel par défaut.
- `updateGoogleConnection({ id, category, color, sync_direction, is_active })` → édition simple.

### 3. Serveur — `syncGoogleCalendarEvents` (existant)
À chaque event upserté, on enrichit avec :
- `category` = `conn.category`
- `color` = `conn.color` (sinon défaut selon category)
Comme ça la vue Agenda affiche automatiquement la bonne couleur sans recalcul côté client.

### 4. Serveur — `findAvailableSlots` (slot finder) et freebusy
Déjà multi-connexions : il itère sur toutes les connexions actives. Aucun changement, sauf vérifier que les 2 connexions sont incluses (oui, on lit `is_active=true`).

### 5. UI Agenda (`src/routes/_authenticated/calendar.tsx`)
- Bouton "Ajouter un autre agenda Google" → ouvre un petit dialog qui appelle `listGoogleCalendars`, laisse choisir l'agenda et le label/catégorie/couleur (préremplis : Perso / orange `#f97316`), puis `addGoogleCalendarFromExisting`.
- Panneau "Agendas" : affiche les 2 lignes avec switch on/off d'affichage (visibilité) — préférence stockée en `localStorage`.
- Légende Pro/Perso (pastille couleur).
- Le formulaire de création d'événement (déjà présent — variable `category`) : on garde le toggle Pro/Perso existant, défaut Pro, mais on l'utilise pour choisir vers quelle `gcal_connection_id` rattacher l'event à la création.

### 6. UI Réunions (`src/components/meetings/meeting-dialog.tsx`)
Ajouter un petit sélecteur "Agenda cible" (Pro / Perso) en haut du dialog, défaut Pro. La valeur est stockée sur la réunion via le champ `calendar_event_id` → l'événement créé porte la bonne `gcal_connection_id`.

### 7. Push vers Google (hors scope ici)
Le code actuel pousse uniquement les **suppressions** vers Google. La création/modification depuis MyHubPro reste locale (pas implémentée aujourd'hui pour le Pro non plus). On ne l'ajoute donc pas dans ce lot pour rester focus. Conséquence : "bidirectionnel" reste, pour l'instant, du pull + delete pour les 2 agendas, comme aujourd'hui pour le Pro. À traiter dans un lot dédié quand vous le souhaitez.

## Détails techniques (résumé)
- Pas de changement RLS, les policies existantes scopent par `user_id`.
- Couleurs par défaut : Pro `#6366f1` (indigo-500), Perso `#f97316` (orange-500).
- Visibilité d'un agenda (afficher/masquer) → `localStorage`, pas de DB.
- Le sélecteur d'agenda à la création écrit `gcal_connection_id` + `category` sur la ligne `calendar_events`.

## Ce qui n'est PAS fait dans ce lot
- Le push **create/update** vers Google (pas en place aujourd'hui non plus). Si vous voulez aussi que la création/modif depuis MyHubPro arrive dans Google, on l'ajoutera après en lot séparé.

Confirmez et je l'implémente.