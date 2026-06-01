import { supabase } from "@/integrations/supabase/client";

export type DocumentRow = {
  id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string | null;
  source_type: "email" | "task" | "meeting" | "manual";
  source_id: string | null;
  account_id: string | null;
  tags: string[];
  description: string | null;
  is_sensitive: boolean;
  sensitive_score: number | null;
  sensitive_reason: string | null;
  local_only: boolean;
  checksum: string | null;
  onedrive_item_id: string | null;
  onedrive_web_url: string | null;
  onedrive_folder_path: string | null;
  saved_at: string | null;
  created_at: string;
  updated_at: string;
};


const BUCKET = "documents";

export async function sha256(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function storagePath(userId: string, sourceType: string, docId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `${userId}/${sourceType}/${docId}-${safe}`;
}

export async function uploadToStorage(path: string, file: Blob): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFromStorage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export async function downloadAsBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}
