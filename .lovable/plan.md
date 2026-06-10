# Lien d'invitation public + validation owner

Tout est intégré dans l'onglet **Collaborateurs** de chaque projet — aucun nouvel onglet, aucune confusion avec les Groupes globaux.

## Flux utilisateur

```text
Owner                          Personne externe              Owner
─────                          ────────────────              ─────
1. Active "Lien d'invitation"  2. Ouvre le lien public  →   4. Voit la demande
   → copie l'URL                  /join/<token>                en attente (badge +
                                  Voit : nom du projet,        email reçu)
                                  description, icône           Bouton "Approuver"
                                  Formulaire :                 ou "Refuser"
                                  prénom / nom / email     →   5. Si approuvé :
                                  → soumet                       email envoyé
                                                                 avec lien d'accès
```

## Base de données

**`collab_spaces`** — 2 colonnes ajoutées :
- `public_join_token` (text, unique, nullable) — token long random
- `public_join_enabled` (boolean, default false)

**`collab_join_requests`** — nouvelle table :
- `id`, `space_id`, `first_name`, `last_name`, `email`, `status` (`pending`/`approved`/`rejected`), `created_at`, `reviewed_at`, `reviewed_by`, `guest_id` (rempli après approbation)
- RLS : owner du space lit/met à jour ses demandes ; insertion publique limitée via server fn (admin client, après vérif token).

## Server functions (`src/lib/collab-join.functions.ts`)

| Fonction | Auth | Rôle |
|---|---|---|
| `getSpaceByJoinToken` | public | retourne `{ name, description, icon, color }` pour la page publique |
| `submitJoinRequest` | public | crée une `pending`, envoie email à l'owner |
| `listJoinRequests` | owner | liste des demandes (pour Collaborateurs) |
| `reviewJoinRequest` | owner | approuve/refuse ; si approuvé → crée `collab_guests` (viewer), envoie email d'accès |
| `toggleJoinLink` | owner | active/désactive + (re)génère le token |

## UI

**`space-collaborators-tab.tsx`** — 2 sections ajoutées en haut :

1. **Lien d'invitation public** (carte repliable)
   - Switch on/off
   - Champ lecture seule avec l'URL + bouton Copier
   - Bouton "Régénérer le lien" (invalide l'ancien)

2. **Demandes en attente** (n'apparaît que s'il y en a)
   - Badge avec compteur
   - Liste : Prénom Nom · email · date · boutons Approuver / Refuser

**Page publique `src/routes/join.$token.tsx`** (similaire à `space.$token.tsx`)
- Hero avec icône/nom/description du projet
- Formulaire prénom + nom + email
- Confirmation : "Demande envoyée — vous recevrez un email après validation"
- Gère token désactivé / projet introuvable

## Emails (templates React Email)

- **`space-join-request`** → owner : "Nouvelle demande pour [projet]" + bouton "Voir les demandes"
- **`space-join-approved`** → demandeur : "Votre accès à [projet] est validé" + lien d'accès personnel (réutilise le système `collab_guests` existant)

## Hors scope (volontairement)

- Pas de lien nominatif (une seule URL publique par projet, comme demandé)
- Pas de rattachement à un groupe de contacts existant — la personne devient un `collab_guest` (viewer) propre au projet, conformément au choix "intégré dans Collaborateurs uniquement"
- Le owner peut promouvoir en "contributor" via les actions existantes après approbation