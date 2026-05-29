# 📁 Itération 14 — Module Documents

Module centralisé pour gérer toutes les pièces jointes et fichiers liés aux emails, tâches, réunions, avec upload manuel, aperçu intégré, détection sensible et politique de rétention.

## 1. Base de données

Migration `documents` :
- `id`, `user_id`, `filename`, `original_filename`
- `file_size` (bigint), `mime_type`, `storage_path`
- `source_type` (enum: `email|task|meeting|manual`)
- `source_id` (uuid, nullable — référence logique selon `source_type`)
- `account_id` (uuid, nullable — pour grouper les emails par compte)
- `tags` (text[]), `description` (text)
- `is_sensitive` (boolean) — si true → `storage_path` reste null, le fichier est en IndexedDB chiffré
- `sensitive_score`, `sensitive_reason`
- `local_only` (boolean) — true si stocké uniquement en IndexedDB
- `checksum` (text) — pour détecter les doublons
- `created_at`, `updated_at`

RLS : `user_id = auth.uid()`. GRANT authenticated + service_role.

Bucket Storage `documents` (privé) + politiques RLS sur `storage.objects` :
- SELECT/INSERT/UPDATE/DELETE limités à `auth.uid()::text = (storage.foldername(name))[1]`
- Convention de chemin : `{user_id}/{source_type}/{document_id}-{filename}`

Table `document_retention_settings` (1 ligne par user) :
- `email_retention_days`, `task_retention_days`, `meeting_retention_days`, `manual_retention_days`
- `max_file_size_mb` (défaut 25)

## 2. Helpers & lib

- `src/lib/documents.ts` — upload/download/delete, génération de checksum (SHA-256), helper de chemin storage
- `src/lib/secure-documents.ts` — extension de `secure-vault` pour stocker des Blobs chiffrés (AES-GCM) dans IndexedDB
- `src/lib/file-icons.ts` — mapping mime type → icône Lucide + couleur badge
- Réutilisation de `detectSensitive` (filename + description) pour la détection

## 3. Route `/documents`

Layout 2 colonnes :
- **Gauche (260px)** : arborescence repliable
  - 📧 Emails → sous-noeuds par `account.name`
  - ✅ Tâches
  - 📋 Réunions
  - 📂 Manuel
  - Filtres : type (PDF/Word/Excel/Image/Autre), date (today/week/month), taille (>5MB), 🔒 sensibles
  - Champ recherche (filename + description, ILIKE)
- **Droite** : toggle Grille/Liste
  - Cartes : icône+miniature (image/PDF), nom, taille, date, badge source coloré, tags
  - Actions : 👁 Aperçu, ⬇ Télécharger, 🔗 Copier lien signé, 🗑 Supprimer

## 4. Aperçu intégré

`<DocumentPreviewSheet>` (Sheet droite) :
- **PDF** : `<iframe src={signedUrl}>` (lecteur navigateur natif — pas de dépendance PDF.js)
- **Image** : `<img>` direct
- **Word/Excel** : message + lien téléchargement (extraction texte hors scope v1)
- **Autres** : métadonnées + bouton download
- Pour les fichiers `is_sensitive` + `local_only` : nécessite vault unlocked, lecture depuis IndexedDB → blob URL temporaire

## 5. Upload manuel

`<UploadDocumentDialog>` :
- Drag & drop + input file (multi)
- Champs : tags (chips), description, lien optionnel vers tâche ou réunion (Select)
- Vérification taille max (paramètres)
- Détection sensible automatique → si oui : chiffrement + IndexedDB (pas de Supabase Storage), prompt PIN si vault verrouillé
- Sinon : upload Supabase Storage + insertion `documents`

## 6. Pièces jointes emails

- Ajout dans la sync IMAP (`supabase/functions/sync-imap`) : extraction des PJ → upload bucket + insert `documents` avec `source_type='email'`, `source_id=email.id`
- Mise à jour de `emails.has_attachment` (déjà existant)
- Dans la fiche email (`inbox.tsx`) : liste des PJ liées (query `documents where source_id = email.id`), miniature, bouton "Enregistrer dans Documents" (édite tags), bouton "Lier à une tâche/réunion" (Select + update `source_type`/`source_id` ou doublon)

Note : la sync IMAP existante est inspectée et étendue pour pousser les PJ. Si le volume est trop gros, fallback : marquer `has_attachment` et lazy-fetch à la demande.

## 7. Paramètres → Documents

Nouvelle section dans `settings.tsx` :
- Rétention par source (sliders / Select jours)
- Taille max fichier
- Jauge quota (somme `file_size` vs un cap visuel arbitraire 1GB)
- Bouton "Supprimer les doublons" (groupBy `checksum` + garder le plus récent)
- Bouton "Export ZIP RGPD" (génère côté client avec `jszip`, téléchargements parallèles via URLs signées)

## 8. Sidebar

Ajout `{ title: "Documents", url: "/documents", icon: FolderOpen }` après Réunions.

## Détails techniques

- Toutes les queries Supabase passent par le client browser (RLS).
- Doublons : détection par checksum SHA-256 calculé à l'upload.
- URLs signées : `supabase.storage.from('documents').createSignedUrl(path, 3600)` pour aperçu et téléchargement.
- Sensibles : réutilisation du `SecureVaultProvider` existant, fonctions `encryptBlob` / `decryptBlob` à ajouter dans `secure-vault.ts`.
- Pas de nouveau serverFn nécessaire — tout passe par le client Supabase + RLS.

## Hors scope v1 (à proposer en itération suivante)
- Extraction texte Word/Excel pour aperçu
- OCR sur PDF scannés
- Recherche plein-texte sur le contenu (pas juste filename/description)
- Versionnage de documents

OK pour partir là-dessus ?
