# Espace participant projet — architecture

## Principe

Le propriétaire invite un participant par email depuis l'app. Le participant reçoit un lien d'accès sécurisé qui lui donne **uniquement** accès à l'espace du projet concerné — rien d'autre de MyHub. Une seule page complète, identique à l'espace projet interne, avec droits ajustés par module.

## Flux d'invitation

```text
Owner (MyHub)                    Participant
    |                                 |
    | 1. Ouvre projet X               |
    | 2. "Inviter" → email + rôle     |
    |                                 |
    |---> email avec lien magique --->|
    |     /p/{space_token}/{guest_token}
    |                                 |
    |                                 | 3. Clic lien
    |                                 | 4. (Option) code OTP par email
    |                                 | 5. Accède à l'espace projet
```

Pas de mot de passe — lien magique + OTP email (déjà supporté par Lovable Cloud). Session limitée à ce projet uniquement.

## Permissions par module (rôle "participant")

| Module    | Droit         |
|-----------|---------------|
| Chat      | Édition       |
| Liens     | Édition       |
| Documents | Édition       |
| Tâches    | Visualisation |
| Réunions  | Édition       |
| Fichiers  | Édition       |
| Sondages  | Édition       |

Le propriétaire garde tout (admin). Possibilité plus tard d'ajouter des rôles "viewer" ou "editor restreint".

## Base de données

Tables existantes réutilisées :
- `collab_spaces` (le projet)
- `collab_guests` (déjà présent : token, email, statut)
- `collab_messages`, `collab_documents`, `collab_space_links`, `collab_surveys`, etc.

Ajouts nécessaires :
- `collab_guests.permissions` (jsonb) — droits par module pour ce participant
- `collab_guest_sessions` — session active du guest (token, expires_at, last_seen)
- RLS policies "guest" : le guest authentifié par son token peut lire/écrire dans son `space_id` uniquement, selon ses permissions

## Routing

- `/collaborate/:spaceId` → vue propriétaire (existante)
- `/p/:spaceToken` → vue participant (nouvelle, publique mais gardée par token + OTP)

Même composant d'espace projet, mais :
- header simplifié (nom du projet + nom participant, pas de nav MyHub)
- modules masqués/lecture seule selon permissions
- pas d'accès aux autres projets ni aux paramètres MyHub

## Étapes d'implémentation (proposées)

1. **Schéma** : ajouter `permissions` à `collab_guests` + table `collab_guest_sessions` + RLS guest.
2. **Invitation** : bouton "Inviter" dans l'espace projet → serverFn qui crée le guest + envoie email (lien magique).
3. **Auth guest** : route `/p/:token` → vérifie token, demande OTP email, ouvre session guest.
4. **Layout participant** : nouveau shell minimal qui charge l'espace projet avec contexte "guest".
5. **Permissions UI** : chaque module lit `guest.permissions[module]` et active édition/lecture/masqué.
6. **Gestion** : panneau "Participants" pour le propriétaire (lister, modifier droits, révoquer).

## Notes techniques

- Email d'invitation : utiliser l'auth Supabase (magic link) plutôt que de réinventer un système de token.
- Audit : chaque action guest loggée dans `audit_log` avec `actor_id = guest.id`.
- WhatsApp peut rester en option future (passerelle d'import), mais n'est plus dans le chemin critique.

---

Tu veux que je commence par l'étape 1 (schéma + invitation) ou tu préfères qu'on ajuste d'abord les permissions / le flux d'auth (magic link seul vs magic link + OTP) ?
