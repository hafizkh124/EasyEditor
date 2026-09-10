/**
 * M12 Phase A — فدیہ / کفارۃ الیمین / صدقۃ الفطر.
 *
 * Ported arithmetic from `islamic-calculator` `store/modules/{fidya,kaffara,
 * sadqaFitr}.ts`. Quantities: ṣāʿ = 2.5 kg, نصف صاع = 1.25 kg, 10 مساکين.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { sadqaFitr, fidya, kaffaraOath, SAA_KG, HALF_SAA_KG, KAFFARA_YAMIN_PEOPLE } from "~shared/zakat/charity";

describe("charity helpers", () => {
  it("sadqaFitr = members × round(wheatPrice × 2.5 kg)", () => {
    const r = sadqaFitr({ familyMembers: 5, wheatPricePerKg: 400 });
    expect(SAA_KG).toBe(2.5);
    expect(r.amount).toBe(5 * Math.round(400 * 2.5)); // 5 × 1000 = 5000
    expect(r.dalil).toMatch(/صاع/);
    expect(r.note).toBeTruthy();
  });

  it("fidya = missedFasts × round(wheatPrice × 1.25 kg)", () => {
    const r = fidya({ missedFasts: 30, wheatPricePerKg: 400 });
    expect(HALF_SAA_KG).toBe(1.25);
    expect(r.amount).toBe(30 * Math.round(400 * 1.25)); // 30 × 500 = 15000
    expect(r.note).toMatch(/قضا/); // warns qada is obligatory for the able
  });

  it("kaffaraOath = brokenOaths × 10 × costPerPerson", () => {
    const r = kaffaraOath({ brokenOaths: 2, option: "feeding", costPerPerson: 300 });
    expect(KAFFARA_YAMIN_PEOPLE).toBe(10);
    expect(r.amount).toBe(2 * 10 * 300); // 6000
    expect(r.note).toMatch(/قسم/); // scoped to oath-breaking only
  });

  it("clamps negative / non-finite inputs to zero", () => {
    expect(sadqaFitr({ familyMembers: -3, wheatPricePerKg: 400 }).amount).toBe(0);
    expect(fidya({ missedFasts: 10, wheatPricePerKg: NaN }).amount).toBe(0);
  });
});
