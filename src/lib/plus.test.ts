import { describe, expect, it } from "vitest";
import { dayText, FIRST_WATCH_MS, offersPlus, plusReminderDue } from "./plus";
import { checkout, onSale, plus, type RelayRequest, type Transport } from "./sync/client";
import { deriveKeys } from "./sync/crypto";

describe("telly Plus's offer after the first watch", () => {
  it("comes once, after a proper watch, while Sync is shown and the household hasn't got it", () => {
    expect(offersPlus(FIRST_WATCH_MS, true, false, false)).toBe(true);
    expect(offersPlus(FIRST_WATCH_MS - 1, true, false, false)).toBe(false);
    expect(offersPlus(FIRST_WATCH_MS, false, false, false)).toBe(false);
    expect(offersPlus(FIRST_WATCH_MS, true, true, false)).toBe(false);
    expect(offersPlus(FIRST_WATCH_MS, true, false, true)).toBe(false);
  });
});

/** Home's reminder of telly Plus: a few days after the first offer, until closed or bought. */
describe("Home's reminder of telly Plus", () => {
  const day = 86_400_000;
  const offered = 1_800_000_000_000;

  it("waits a few days after the offer", () => {
    expect(plusReminderDue(offered + 2 * day, offered, false, true, false)).toBe(false);
    expect(plusReminderDue(offered + 3 * day, offered, false, true, false)).toBe(true);
  });

  it("never comes without an offer, once closed, with telly Plus or with Sync hidden", () => {
    expect(plusReminderDue(offered, undefined, false, true, false)).toBe(false);
    expect(plusReminderDue(offered + 9 * day, offered, true, true, false)).toBe(false);
    expect(plusReminderDue(offered + 9 * day, offered, false, true, true)).toBe(false);
    expect(plusReminderDue(offered + 9 * day, offered, false, false, false)).toBe(false);
  });
});

describe("telly Plus on the relay", () => {
  const keys = deriveKeys("0123456789ABCDEF");
  const asked: RelayRequest[] = [];
  const answer = (status: number, body: unknown): Transport => async (r) => {
    asked.push(r);
    return { status, text: JSON.stringify(body) };
  };

  it("asks about the household's telly Plus as this device", async () => {
    expect(await plus(answer(200, { until: 21000, onSale: true }), "https://relay.test/", keys, "00112233aabbccdd")).toEqual({ until: 21000, onSale: true });
    expect(asked.at(-1)).toMatchObject({ method: "GET", url: `https://relay.test/v1/${keys.mailbox}/00112233aabbccdd/plus`, auth: keys.auth });
    expect(await plus(answer(200, { until: null, onSale: false }), "https://relay.test", keys, "00112233aabbccdd")).toEqual({ until: null, onSale: false });
  });

  it("gets a checkout link, and says when there's none", async () => {
    expect(await checkout(answer(200, { url: "https://relay.test/plus/abc" }), "https://relay.test", keys)).toBe("https://relay.test/plus/abc");
    expect(asked.at(-1)).toMatchObject({ method: "POST", url: `https://relay.test/v1/${keys.mailbox}/plus/checkout` });
    await expect(checkout(answer(503, {}), "https://relay.test", keys)).rejects.toThrow("isn't on sale");
  });

  it("asks whether it's on sale without a household", async () => {
    expect(await onSale(answer(200, { onSale: true }), "https://relay.test")).toBe(true);
    expect(await onSale(answer(500, {}), "https://relay.test")).toBe(false);
    expect(await onSale(async () => { throw new Error("offline"); }, "https://relay.test")).toBe(false);
  });

  it("writes the relay's days as dates", () => {
    expect(dayText(20759)).toBe("2 November 2026");
  });
});
