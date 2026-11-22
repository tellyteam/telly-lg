import type { Account } from "./xtream";

/**
 * The subscription's details in words, for Settings and the reminder as it ends: the same words as
 * on Fire TV (AccountText there).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left; 0 on the last day, negative once it has ended. */
export const daysLeft = (expiresAt: number, now: number) => Math.floor((expiresAt - now) / DAY_MS);

export function reminder(days: number): string {
  if (days === 0) return "Your subscription ends today.";
  if (days === 1) return "Your subscription ends tomorrow.";
  return `Your subscription ends in ${days} days.`;
}

/** Once a day, in a subscription's last week: the reminder to show, or null. */
export function reminderDue(a: Account, now: number): string | null {
  if (a.expiresAt == null) return null;
  const days = daysLeft(a.expiresAt, now);
  return days >= 0 && days <= 7 ? reminder(days) : null;
}

const dateText = (ms: number, timeZone?: string) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone });

/** "Active · ends 12 March 2027 (in 149 days)", "Trial · ends …", "Active · no end date". */
export function summary(a: Account, now: number, timeZone?: string): string {
  const status = a.trial ? "Trial" : !a.status ? "Active" : a.status[0].toUpperCase() + a.status.slice(1);
  if (a.expiresAt == null) return `${status} · no end date`;
  const date = dateText(a.expiresAt, timeZone);
  const days = daysLeft(a.expiresAt, now);
  if (days < 0) return `${status} · ended ${date}`;
  const left = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `${status} · ends ${date} (${left})`;
}

/** "1 of 2 connections in use" (this TV isn't streaming while Settings is open). */
export function connections(a: Account): string | null {
  const max = a.maxConnections;
  if (max == null) return null;
  const noun = `connection${max === 1 ? "" : "s"}`;
  return a.activeConnections == null ? `${max} ${noun} allowed` : `${a.activeConnections} of ${max} ${noun} in use`;
}
