# Plan — Module Note de frais complet

Gros chantier livré en une fois. Je ne touche à aucun autre module ; je conserve la dialog IA actuelle (`ExpenseReportDialog`) qui restera utilisable depuis l'assistant, mais ajoute un module dédié à `/expenses`.

## 1. Migration Supabase

Tables `expense_reports`, `expense_items`, `expense_templates` (schéma exact du prompt) avec :
- `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` + `GRANT ALL TO service_role` (obligatoire sinon Data API renvoie permission denied)
- RLS `auth.uid() = user_id` (FOR ALL split en USING + WITH CHECK)
- Trigger `set_updated_at` sur `expense_reports`
- Bucket Storage privé `expense-receipts` + policies par utilisateur (préfixe `userId/…`) pour justificatifs et modèles uploadés

## 2. Route `/expenses` (sous `_authenticated`)

`src/routes/_authenticated/expenses.tsx` :
- Liste des notes : titre, objet, date, statut (badge coloré Brouillon/Soumise/Approuvée/Rejetée/Payée), total
- Boutons « + Nouvelle note » et « Importer un modèle »
- Onglet « Modèles » : upload + liste des modèles analysés
- Lien ajouté à la sidebar (`app-sidebar.tsx`)

## 3. Composants

- `src/components/expenses/expense-report-form.tsx` — formulaire complet :
  - **Identification** (en dur, éditable) : Dr Stéphane LAFITTE / PU-PH / UMCV / CHU Bordeaux / RPPS optionnel
  - **Mission** : intitulé, cadre (select), organisme, n° mission
  - **Tableau dépenses** : ligne éditable avec date / catégorie (icônes) / description / justificatif (upload) / TTC / TVA% / HT (auto)
  - Cas véhicule perso : km + barème 2024 (0.426 €/km < 5000 km) → montant auto
  - Drag & drop réordonnancement (dnd-kit)
  - Upload justificatif → Storage → lien `documents`
  - **Récap** : total auto, avances, à rembourser, mode (virement/chèque), IBAN
  - **Signature** : Bordeaux / aujourd'hui / Dr Stéphane LAFITTE
  - **PJ** : liste numérotée + compteur + miniature
- `src/components/expenses/expenses-list.tsx`
- `src/components/expenses/import-from-email-dialog.tsx` — filtre emails par mots-clés, sélection, appel `extractExpenseFromEmail`, validation manuelle avant ajout
- `src/components/expenses/template-upload-dialog.tsx` + liste modèles

## 4. Server functions `src/lib/expense.functions.ts`

Toutes via `createServerFn` + `requireSupabaseAuth` :
- CRUD : `listReports`, `getReport`, `createReport`, `updateReport`, `deleteReport`, `addItem`, `updateItem`, `deleteItem`, `reorderItems`
- `extractExpenseFromEmail({ emailId })` — IA `google/gemini-3-flash-preview` lit body + PJ images, retourne `{ date, amount_ttc, category, description, vendor, tva_rate }` ; jamais d'insert auto
- `analyzeExpenseTemplate({ templateId })` — analyse fichier (texte extrait), IA détecte champs/colonnes/zones, écrit `ai_mapping`
- `fillExpenseTemplate({ reportId, templateId })` — applique mapping :
  - Excel → SheetJS (`xlsx`)
  - Word → `docx`
  - PDF → `pdf-lib`
  - Retourne `{ filename, mime, base64 }`
- `generateExpensePDF({ reportId })` — jsPDF (déjà installé) : en-tête, identification, mission, tableau dépenses, récap, signature (Bordeaux, date, Dr S. LAFITTE), liste numérotée des PJ. Retourne base64.
- Sauvegarde finalisée → insert dans `documents` (`source_type='expense'`).

## 5. Dépendances

À ajouter : `xlsx`, `pdf-lib`, `docx`, `@dnd-kit/core`, `@dnd-kit/sortable`. `jspdf` et `jszip` déjà installés.

## 6. Module Documents

Filtre « Notes de frais » via `source_type='expense'` — léger ajustement non intrusif.

## Détails techniques

- Storage : bucket privé `expense-receipts`, chemins `{userId}/{reportId}/{itemId}.ext` et `{userId}/templates/{templateId}.ext`
- Imports server-only (`xlsx`, `pdf-lib`, `docx`) **dans le handler** via `await import(...)` pour éviter pollution du bundle client
- `attachSupabaseAuth` déjà configuré (modules existants l'utilisent)
- Dialog IA actuelle inchangée — coexiste avec ce nouveau module

## Fichiers créés / modifiés

**Créés** :
- `supabase/migrations/<timestamp>_expense_reports.sql`
- `src/routes/_authenticated/expenses.tsx`
- `src/components/expenses/expense-report-form.tsx`
- `src/components/expenses/expenses-list.tsx`
- `src/components/expenses/import-from-email-dialog.tsx`
- `src/components/expenses/template-upload-dialog.tsx`
- `src/components/expenses/category-icons.tsx`
- `src/lib/expense.functions.ts`

**Modifiés** :
- `src/components/app-sidebar.tsx` (entrée « Notes de frais »)
- `src/components/documents/…` (filtre source_type='expense', minimal)

Confirme et je lance migration + code.
