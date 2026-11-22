import { describe, expect, it } from "vitest";
import { connections, daysLeft, reminder, reminderDue, summary } from "./account";
import { account } from "./xtream";

/** The same cases as Fire TV's AccountTextTest, so both say the same. */
describe("subscription details", () => {
  const now = 1_791_000_000_000; // 2026-10-03
  const DAY = 24 * 60 * 60 * 1000;

  it("reads the subscription from user_info", () => {
    const a = account({ user_info: { auth: 1, status: "Active", exp_date: "1803945600", max_connections: "2", active_cons: "1", is_trial: "0" } });
    expect(a.expiresAt).toBe(1_803_945_600_000);
    expect(a.maxConnections).toBe(2);
    expect(a.activeConnections).toBe(1);
    expect(summary(a, now, "UTC")).toBe("Active · ends 2 March 2027 (in 149 days)");
    expect(connections(a)).toBe("1 of 2 connections in use");
  });

  it("no end date, trials and endings read naturally", () => {
    const never = account({ user_info: { auth: 1, status: "Active", exp_date: null, max_connections: 1 } });
    expect(never.expiresAt).toBeUndefined();
    expect(summary(never, now, "UTC")).toBe("Active · no end date");
    expect(connections(never)).toBe("1 connection allowed");
    expect(summary({ ...never, trial: true, expiresAt: now + 36 * 60 * 60 * 1000 }, now, "UTC")).toMatch(/^Trial · ends 4 October 2026 \(tomorrow\)/);
    expect(summary({ ...never, expiresAt: now - 3 * DAY }, now, "UTC")).toBe("Active · ended 30 September 2026");
    expect(account({ user_info: { auth: 1, exp_date: "0" } }).expiresAt).toBeUndefined();
  });

  it("reminder wording, in the last week only", () => {
    expect(reminder(0)).toBe("Your subscription ends today.");
    expect(reminder(1)).toBe("Your subscription ends tomorrow.");
    expect(reminder(5)).toBe("Your subscription ends in 5 days.");
    expect(daysLeft(now + 1000, now)).toBe(0);
    expect(daysLeft(now - 1000, now)).toBe(-1);
    expect(reminderDue({ authenticated: true, outputFormats: [], expiresAt: now + 3 * DAY + 1000 }, now)).toBe("Your subscription ends in 3 days.");
    expect(reminderDue({ authenticated: true, outputFormats: [], expiresAt: now + 9 * DAY }, now)).toBeNull();
    expect(reminderDue({ authenticated: true, outputFormats: [], expiresAt: now - DAY }, now)).toBeNull();
    expect(reminderDue({ authenticated: true, outputFormats: [] }, now)).toBeNull();
  });
});
