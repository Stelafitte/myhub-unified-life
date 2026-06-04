# Assistant IA global dans la barre de recherche

Ajout d'un bouton **IA** à droite de la recherche globale qui ouvre une grande fenêtre de conversation. L'IA comprend une demande structurée, interroge les données de la plateforme (mails, contacts, tâches, événements, réunions, documents), affiche les résultats et propose des **actions** modifiables individuellement ou exécutables en lot.

Livré par étapes pour valider chaque brique avant la suivante.

---

## Phase 1 — Fondations (UI + recherche mails)

**Objectif** : pouvoir poser une question en langage naturel et obtenir une liste de mails pertinents + un résumé IA.

- Bouton **Sparkles "IA"** dans `GlobalSearch` (à droite du champ).
- Modale large (max-w-5xl, hauteur ~85vh) avec :
  - zone de prompt multi-ligne en haut,
  - zone de résultats / conversation au centre,
  - barre d'actions proposées en bas (vide pour l'instant).
- ServerFn `aiAssistantQuery` (TanStack `createServerFn`) qui :
  - reçoit le prompt + contexte (route active, filtres),
  - appelle Lovable AI (`google/gemini-3-flash-preview`) avec tool calling,
  - tool `search_emails(query, from?, theme?, dateRange?)` → SELECT sur `emails`,
  - retourne `{ summary, matches: Email[], proposedActions: [] }`.
- Exemple validé : *"trouve les mails de Ternacle traitant d'IDEAL"*.

## Phase 2 — Catalogue d'actions + édition

**Objectif** : transformer les résultats en actions concrètes éditables.

- Type unifié `ProposedAction` :
  ```
  reply_email | forward_email | bulk_reply | bulk_forward
  | create_task | create_event | create_meeting
  | create_contact | save_document
  ```
- Chaque action est rendue dans une carte avec :
  - champs éditables (destinataire, objet, corps, date, durée, thème…),
  - bouton **Exécuter**,
  - case à cocher pour sélection multiple.
- Barre d'actions groupées : **Tout exécuter / Exécuter sélection / Tout rejeter**.
- Pour les réponses mail : l'IA pré-rédige un brouillon par mail, modifiable avant envoi.
- Exemple validé : *"traite les mails de demande d'info du DIU d'échocardiographie et propose-moi les réponses adaptées"* → N cartes `reply_email` éditables, exécution une par une ou en lot.

## Phase 3 — Extension aux autres entités

**Objectif** : l'IA peut chercher / agir sur tout le périmètre.

- Tools serveur supplémentaires : `search_contacts`, `search_tasks`, `search_events`, `search_meetings`, `search_documents`.
- Tools d'exécution : `do_create_task`, `do_create_event`, `do_create_meeting`, `do_create_contact`, `do_save_document`, `do_send_reply`, `do_forward`.
- Chaque exécution respecte les RLS (serverFn protégée par `requireSupabaseAuth`) et retourne un statut visible dans la carte (succès / erreur / lien vers l'objet créé).

## Phase 4 — Prompts associés à chaque outil

**Objectif** : enrichir l'IA avec les `ai_prompts` déjà stockés en base.

- Lecture de `ai_prompts` filtrés par `target` (général + outil en cours).
- Injection automatique en system prompt pour orienter le ton / les règles métier.
- Indicateur visible "prompts actifs : N" dans la modale, avec lien vers Réglages > IA.

---

## Détails techniques

- **Backend** : `src/lib/ai-assistant.functions.ts` (createServerFn + middleware Supabase auth). Modèle par défaut `google/gemini-3-flash-preview` via le helper existant `createLovableAiGatewayProvider`. Tool-calling avec `stopWhen: stepCountIs(50)`.
- **Frontend** :
  - `src/components/ai/ai-assistant-modal.tsx` (modale large, conversation, actions),
  - `src/components/ai/action-card.tsx` (rendu + édition par type d'action),
  - bouton ajouté dans `src/components/global-search.tsx`.
- **Sécurité** : toutes les lectures/écritures passent par le client Supabase authentifié (RLS appliquée comme l'utilisateur). Aucune action n'est exécutée sans clic explicite.
- **Pas de migration DB** nécessaire en Phase 1–3 ; Phase 4 réutilise `ai_prompts` existant.

---

**Je propose de commencer par la Phase 1 dès validation**, puis d'enchaîner les phases en validant le rendu à chaque étape. Confirme-moi le go (ou ajuste l'ordre des phases) et je démarre.