import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractUkPostcode,
  geocodeAddress,
  geocodePostcode,
} from "@/server/geocode";

describe("extractUkPostcode", () => {
  it("pulls a postcode out of a full address, normalised", () => {
    expect(extractUkPostcode("Bethnal Green Rd, London EC2A 3AR")).toBe("EC2A 3AR");
    expect(extractUkPostcode("Buckhold Rd, London SW18 4AF")).toBe("SW18 4AF");
    expect(extractUkPostcode("Queen Elizabeth Olympic Park, London E20 1EJ")).toBe("E20 1EJ");
  });

  it("handles short outward codes and missing internal space", () => {
    expect(extractUkPostcode("10 Downing St, SW1A2AA")).toBe("SW1A 2AA");
    expect(extractUkPostcode("somewhere e1 6an here")).toBe("E1 6AN");
  });

  it("returns null when there is no postcode or no address", () => {
    expect(extractUkPostcode("Bethnal Green Rd, London")).toBeNull();
    expect(extractUkPostcode(null)).toBeNull();
    expect(extractUkPostcode(undefined)).toBeNull();
    expect(extractUkPostcode("")).toBeNull();
  });
});

describe("geocodePostcode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns lat/lng from a successful postcodes.io response", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ result: { latitude: 51.5265, longitude: -0.0805 } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const point = await geocodePostcode("EC2A 3AR");
    expect(point).toEqual({ lat: 51.5265, lng: -0.0805 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.postcodes.io/postcodes/");
    expect(url).toContain("EC2A");
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await geocodePostcode("ZZ99 9ZZ")).toBeNull();
  });

  it("returns null when the payload lacks coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ result: {} }) })));
    expect(await geocodePostcode("EC2A 3AR")).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await geocodePostcode("EC2A 3AR")).toBeNull();
  });
});

describe("geocodeAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the postcode then geocodes it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { latitude: 51.4571, longitude: -0.1935 } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const point = await geocodeAddress("Buckhold Rd, London SW18 4AF");
    expect(point).toEqual({ lat: 51.4571, lng: -0.1935 });
  });

  it("returns null without calling fetch when there is no postcode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geocodeAddress("Bethnal Green Rd, London")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
