import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export function QuorumBadge({
  acceptedCount,
  minimum,
}: {
  acceptedCount: number;
  minimum: number | null | undefined;
}) {
  if (!minimum || minimum <= 0) return null;
  const ok = acceptedCount >= minimum;
  return (
    <Badge
      variant={ok ? "default" : "destructive"}
      className="gap-1"
      title="Quorum basé sur les RSVP 'accepté'"
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      Quorum {acceptedCount}/{minimum}
    </Badge>
  );
}
