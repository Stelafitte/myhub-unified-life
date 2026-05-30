# Plan — Offline-first complet

Objectif : l'app fonctionne en lecture **et** en écriture hors ligne, avec synchronisation automatique au retour réseau. Installable comme PWA.

L'infrastructure de base existe déjà partiellement (`sync-queue.ts`, `inbox-cache.ts`, `useNetworkStatus`, table `sync_queue`). Il faut la **généraliser à toutes les entités** et brancher la lecture sur le cache local en mode dégradé.

## Périmètre

Entités couvertes en offline complet :
- **Mails** (lecture + read/star/archive/suppression)
- **Contacts** (lecture + CRUD)
- **Tâches** (déjà partiel — finaliser)
- **Événements calendrier** (lecture + CRUD)
- **Plan d'opération / thèmes** (lecture + édition)
- **Réunions** (lecture seule cache + création en file)

Hors périmètre :
- Synchronisation IMAP/Gmail offline (impossible sans serveur)
- Édition de documents binaires offline
- Résolution de conflits sémantique (stratégie simple : last-write-wins côté serveur + log des conflits)

## Architecture

```text
                       ┌──────────────────┐
   UI (React)  ───────►│  data-layer.ts   │  hook par entité
                       └────────┬─────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
         IndexedDB        sync-queue          Supabase
        (cache lecture)  (mutations offline)  (source vérité)
              ▲                 │                  ▲
              └─── flush on online ────────────────┘
```

**Règle d'or** : chaque hook de données (`useEmails`, `useContacts`…) lit d'abord le cache IndexedDB (résultat instantané), puis tente Supabase en arrière-plan et met à jour le cache. Les mutations passent par un wrapper qui choisit en ligne→Supabase direct / hors ligne→sync_queue.

## Étapes

### 1. Cache générique IndexedDB
Généraliser `inbox-cache.ts` en un module `local-cache.ts` qui gère N stores (emails, contacts, calendar_events, tasks, op_plan_themes, op_plan_subthemes, meetings). API uniforme : `cacheAll(store, items)`, `loadCached(store)`, `loadCachedById(store, id)`, `removeCached(store, id)`.

### 2. Sync-queue complète
Étendre `sync-queue.ts` :
- Support `op_plan_themes`, `op_plan_subthemes`, `meeting` (déjà partiel pour les autres)
- Persistance optimiste : appliquer la mutation dans le cache IndexedDB immédiatement, puis tenter le serveur
- Réplique côté Supabase dans la table `sync_queue` quand en ligne, pour audit cross-device
- Stratégie de retry exponentiel sur échec serveur (3 tentatives)

### 3. Hooks de données offline-first
Créer un hook générique `useOfflineData<T>(store, fetcher)` qui :
1. Affiche immédiatement le cache local
2. Lance fetcher Supabase si en ligne
3. Met à jour cache + UI
4. Re-déclenche au retour `online`

Refactorer les pages suivantes pour l'utiliser :
- `src/routes/_authenticated/inbox.tsx`
- `src/routes/_authenticated/contacts.tsx`
- `src/routes/_authenticated/calendar.tsx`
- `src/routes/_authenticated/tasks.tsx` (déjà partiel)
- `src/routes/_authenticated/meetings.tsx`
- `src/components/settings/plan-operation-section.tsx`
- `src/routes/_authenticated/dashboard.tsx` (compteurs)

### 4. Wrapper de mutation universel
`mutate(entity, action, payload)` qui :
- Met à jour cache local immédiatement (optimistic UI)
- Si online → Supabase direct
- Si offline → `enqueue()` et marque l'item `_pending: true`
- Toast non bloquant en cas d'échec

### 5. PWA installable + service worker
- Activer un service worker qui pré-cache l'app shell (HTML/JS/CSS) → l'app s'ouvre offline
- Manifeste déjà présent dans `public/manifest.webmanifest` — vérifier et compléter
- Bouton "Installer l'app" dans la barre quand `beforeinstallprompt` est dispo
- Le SW doit **exclure** `/api/*`, `/login`, OAuth callback du cache (NetworkFirst sur ces routes)

### 6. UI de statut sync
- Indicateur global déjà partiellement présent (`useSyncStatus`) → l'afficher dans `app-header.tsx`
- Badge nombre d'actions en attente + bouton "Synchroniser maintenant"
- Toast "X actions synchronisées" au retour en ligne
- Page Paramètres → section "Synchronisation" listant les opérations en attente et permettant de retry/supprimer une opération bloquée

### 7. Stratégie de conflits (simple)
- Last-write-wins côté serveur (timestamp `updated_at`)
- Si serveur a une version plus récente au flush → on garde la version serveur et on log l'action perdue dans un nouveau toast "Action écrasée par version serveur (cliquer pour voir)"
- Pas de merge automatique

### 8. Gestion du token expiré (corollaire de l'option C)
- Quand une requête Supabase échoue avec `refresh_token_not_found` ou 401 → bannière "Session expirée — reconnectez-vous pour synchroniser" avec bouton de re-login
- Les mutations restent dans la queue jusqu'à reconnexion (pas perdues)

## Détails techniques

**IndexedDB** : un seul DB `myhubpro-cache` v2 avec stores par entité, index `received_at`/`updated_at`/`user_id`. Limite 500 items par store (LRU).

**Service worker** : `vite-plugin-pwa` avec `registerType: "autoUpdate"`, `navigateFallback: '/index.html'`, `runtimeCaching` NetworkFirst pour `/api/*` et `/auth/*`, CacheFirst pour assets statiques. **Désactiver en dev** pour éviter les soucis dans l'iframe preview Lovable. L'utilisateur sera prévenu : PWA fonctionnelle uniquement sur le site publié, pas dans l'éditeur.

**Auth offline** : la session Supabase est déjà persistée en `localStorage`. Tant que le JWT n'est pas expiré (~1h), l'app reconnaît l'utilisateur même offline. Au-delà → bannière de reconnexion mais cache toujours lisible.

**Migration DB** : aucune. La table `sync_queue` existe déjà.

## Estimation
~600-900 lignes de code à écrire/modifier, réparties sur ~15 fichiers. Je le ferai en une seule passe.

## Risques
- L'écriture optimiste peut afficher des données "fantômes" si le serveur refuse (ex : violation RLS). Mitigation : rollback du cache + toast d'erreur.
- Le service worker peut cacher du code obsolète après un déploiement. Mitigation : `autoUpdate` + reload prompt.
- Les pièces jointes lourdes (mails avec PDF) ne seront pas cachées (poids IndexedDB). Seul le texte/HTML l'est.
