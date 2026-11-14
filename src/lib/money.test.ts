import { describe, expect, it } from "vitest";
import { centsToPesos, formatMoney, isCurrency, pesosToCents } from "./money";

describe("pesos at the edge with pey", () => {
  it("turns centavos into the peso number pey takes", () => {
    expect(centsToPesos(41_667)).toBe(416.67);
    expect(centsToPesos(100)).toBe(1);
    expect(centsToPesos(1)).toBe(0.01);
    expect(centsToPesos(250_000)).toBe(2500);
  });

  it("round-trips every centavo amount without drift", () => {
    for (let c = 0; c < 20_000; c += 7) {
      expect(pesosToCents(centsToPesos(c))).toBe(c);
    }
  });

  it("reads pey amounts that floats cannot hold exactly", () => {
    expect(pesosToCents(0.29)).toBe(29);
    expect(pesosToCents(102.5)).toBe(10_250);
  });

  it("refuses what is not money", () => {
    expect(() => centsToPesos(1.5)).toThrow();
    expect(() => centsToPesos(-1)).toThrow();
    expect(() => pesosToCents(Number.NaN)).toThrow();
  });
});

describe("labels", () => {
  it("always says which currency", () => {
    expect(formatMoney(250_000)).toBe("$2,500.00 MXN");
    expect(formatMoney(250_000, "MXN")).toBe("$2,500.00 MXN");
    expect(isCurrency("MXN")).toBe(true);
    expect(isCurrency("USD")).toBe(false);
  });
});
