import { describe, expect, it } from "vitest";
import { parseStatValue } from "./realRepository";

describe("parseStatValue", () => {
  it("propustí čísla", () => {
    expect(parseStatValue(14)).toBe(14);
    expect(parseStatValue(0)).toBe(0);
  });

  it("ořízne procenta (držení míče, přesnost přihrávek)", () => {
    expect(parseStatValue("65%")).toBe(65);
    expect(parseStatValue("87.5%")).toBe(87.5);
  });

  it("zvládne desetinnou čárku", () => {
    expect(parseStatValue("1,8")).toBe(1.8);
  });

  it("vrátí null pro chybějící/nečíselné hodnoty", () => {
    expect(parseStatValue(null)).toBeNull();
    expect(parseStatValue("")).toBeNull();
    expect(parseStatValue("N/A")).toBeNull();
    expect(parseStatValue("-")).toBeNull();
  });
});
