/** telly Plus on a TV: when it's offered, and what Settings → Sync and the offer share. The same rules as on Fire TV. */

/** How long a first watch is before leaving the player offers telly Plus. In development: VITE_TELLY_FIRST_WATCH (seconds). */
export const FIRST_WATCH_MS = ((import.meta.env.DEV && Number(import.meta.env.VITE_TELLY_FIRST_WATCH)) || 5 * 60) * 1000;

/** Whether leaving the player after [watchedMs] offers telly Plus. */
export const offersPlus = (watchedMs: number, syncShown: boolean, hasPlus: boolean, offeredBefore: boolean) =>
  watchedMs >= FIRST_WATCH_MS && syncShown && !hasPlus && !offeredBefore;

/** Days after telly Plus was first offered that Home shows its one reminder. */
export const PLUS_REMINDER_DAYS = 3;

/** Home's reminder: from a few days after the first offer, until it's closed or telly Plus is on. */
export const plusReminderDue = (now: number, offeredAt: number | undefined, closed: boolean, syncShown: boolean, hasPlus: boolean) =>
  !!offeredAt && !closed && syncShown && !hasPlus && now - offeredAt >= PLUS_REMINDER_DAYS * 86_400_000;

/** A day count (days since 1970, as the relay keeps it) as a date, e.g. 2 November 2027. */
export const dayText = (day: number) =>
  new Date(day * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * While a checkout QR code shows, the relay is asked whether the payment's come through (or telly
 * Plus was moved here): every few seconds at first, then every half minute for as long as it's up.
 * Returns a function that stops asking.
 */
export function pollPlus(refresh: () => Promise<void>): () => void {
  let asked = 0;
  let timer: ReturnType<typeof setTimeout>;
  const next = () => {
    timer = setTimeout(async () => {
      await refresh();
      next();
    }, asked++ < 120 ? 5_000 : 30_000);
  };
  next();
  return () => clearTimeout(timer);
}
