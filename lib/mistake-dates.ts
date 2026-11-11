const beijingDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function beijingDate(value: string | Date): string {
  const parts = beijingDateFormatter.formatToParts(typeof value === "string" ? new Date(value) : value);
  const year = parts.find(part => part.type === "year")!.value.padStart(4, "0");
  const month = parts.find(part => part.type === "month")!.value;
  const day = parts.find(part => part.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
