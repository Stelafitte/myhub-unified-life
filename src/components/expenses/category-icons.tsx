import type { ExpenseCategory } from "@/lib/expense.functions";

export const CATEGORY_META: Record<ExpenseCategory, { label: string; icon: string }> = {
  transport_commun: { label: "Transport", icon: "🚂" },
  vehicule_perso: { label: "Véhicule perso.", icon: "🚗" },
  hebergement: { label: "Hébergement", icon: "🏨" },
  repas: { label: "Repas", icon: "🍽️" },
  inscription: { label: "Inscription", icon: "📋" },
  documentation: { label: "Documentation", icon: "📚" },
  reprographie: { label: "Reprographie", icon: "🖨️" },
  materiel: { label: "Matériel", icon: "💻" },
  telephone: { label: "Téléphone", icon: "📞" },
  visa: { label: "Visa / voyage", icon: "✈️" },
  autre: { label: "Autre", icon: "•" },
};
