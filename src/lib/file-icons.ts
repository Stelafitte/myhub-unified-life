import { FileText, FileImage, FileSpreadsheet, FileVideo, FileAudio, FileArchive, FileCode, File as FileIcon, FileType } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type FileCategory = "pdf" | "word" | "excel" | "image" | "video" | "audio" | "archive" | "code" | "text" | "other";

export function categorize(mime?: string | null, filename?: string | null): FileCategory {
  const m = (mime ?? "").toLowerCase();
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") || ["png","jpg","jpeg","gif","webp","svg","bmp","heic"].includes(ext)) return "image";
  if (m.startsWith("video/") || ["mp4","mov","avi","mkv","webm"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3","wav","ogg","m4a","flac"].includes(ext)) return "audio";
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || ["zip","rar","7z","tar","gz"].includes(ext)) return "archive";
  if (m.includes("word") || ["doc","docx","odt","rtf"].includes(ext)) return "word";
  if (m.includes("sheet") || m.includes("excel") || m.includes("csv") || ["xls","xlsx","ods","csv"].includes(ext)) return "excel";
  if (["js","ts","tsx","jsx","py","go","rs","java","c","cpp","sh","html","css","json","yml","yaml","xml"].includes(ext)) return "code";
  if (m.startsWith("text/") || ["txt","md","log"].includes(ext)) return "text";
  return "other";
}

export function iconFor(cat: FileCategory): LucideIcon {
  switch (cat) {
    case "pdf": return FileType;
    case "image": return FileImage;
    case "excel": return FileSpreadsheet;
    case "word": return FileText;
    case "video": return FileVideo;
    case "audio": return FileAudio;
    case "archive": return FileArchive;
    case "code": return FileCode;
    case "text": return FileText;
    default: return FileIcon;
  }
}

export function colorFor(cat: FileCategory): string {
  switch (cat) {
    case "pdf": return "text-red-600";
    case "image": return "text-purple-600";
    case "excel": return "text-green-600";
    case "word": return "text-blue-600";
    case "video": return "text-pink-600";
    case "audio": return "text-amber-600";
    case "archive": return "text-yellow-700";
    case "code": return "text-slate-700";
    default: return "text-muted-foreground";
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 o";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function sourceLabel(s: string): { label: string; cls: string } {
  switch (s) {
    case "email": return { label: "📧 Email", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
    case "task": return { label: "✅ Tâche", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
    case "meeting": return { label: "📋 Réunion", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" };
    default: return { label: "📂 Manuel", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
  }
}
