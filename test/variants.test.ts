import { describe, expect, test } from "bun:test";
import { parseVariants, resolveVariant } from "../src/parse.ts";

const fx = () => Bun.file(new URL("./fixtures/variants.html", import.meta.url)).text();

describe("variants", () => {
  test("reads options, combinations and the current pick", async () => {
    const v = parseVariants(await fx())!;
    expect(v.dimensions.map((d) => [d.name, d.values.length])).toEqual([["Size", 3], ["Color", 3]]);
    expect(v.combos).toHaveLength(5);
    expect(v.selected).toEqual({ Size: "Medium", Color: "White - 6 Pack" });
    expect(v.currentAsin).toBe("B0TEST0002");
  });

  test("resolves forgiving picks to the child ASIN", async () => {
    const v = parseVariants(await fx())!;
    expect(resolveVariant(v, { size: "med", color: "black 7" }).asin).toBe("B0TEST0001");
    expect(resolveVariant(v, { size: "large" }).asin).toBe("B0TEST0003"); // keeps the current colour
  });

  test("ambiguous, unknown and unsold picks explain themselves", async () => {
    const v = parseVariants(await fx())!;
    expect(() => resolveVariant(v, { color: "black" })).toThrow(/matches several Color options/);
    expect(() => resolveVariant(v, { size: "tiny" })).toThrow(/Available: Small, Medium, Large/);
    expect(() => resolveVariant(v, { size: "large", color: "black 7" })).toThrow(/isn't sold/);
    expect(() => resolveVariant(v, { material: "cotton" })).toThrow(/no "material" option/);
  });

  test("pages without options have no variants", () => {
    expect(parseVariants("<html><body>plain product</body></html>")).toBeNull();
  });
});

test("stray punctuation around option names is removed", () => {
  const html = `"dimensions":["color_name"],"variationValues":{"color_name":[",Gold (Personalized)","Silver ,"]},"dimensionToAsinMap":{"0":"B000000001","1":"B000000002"}`;
  expect(parseVariants(html)!.dimensions[0]!.values).toEqual(["Gold (Personalized)", "Silver"]);
});
