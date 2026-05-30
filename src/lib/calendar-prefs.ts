import { useEffect, useState } from "react";

export type CalendarHours = { startHour: number; endHour: number };

export const DEFAULT_CALENDAR_HOURS: CalendarHours = { startHour: 6, endHour: 24 };

function read(): CalendarHours {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_HOURS;
  try {
    const raw = localStorage.getItem("myhub-prefs");
    if (!raw) return DEFAULT_CALENDAR_HOURS;
    const p = JSON.parse(raw);
    const s = Number.isFinite(p?.calendarStartHour) ? Math.max(0, Math.min(23, p.calendarStartHour)) : DEFAULT_CALENDAR_HOURS.startHour;
    const e = Number.isFinite(p?.calendarEndHour) ? Math.max(s + 1, Math.min(24, p.calendarEndHour)) : DEFAULT_CALENDAR_HOURS.endHour;
    return { startHour: s, endHour: e };
  } catch {
    return DEFAULT_CALENDAR_HOURS;
  }
}

export function useCalendarHours(): CalendarHours {
  const [h, setH] = useState<CalendarHours>(read);
  useEffect(() => {
    const handler = () => setH(read());
    window.addEventListener("storage", handler);
    window.addEventListener("myhub-prefs-changed", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("myhub-prefs-changed", handler);
    };
  }, []);
  return h;
}
