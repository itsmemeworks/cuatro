import { describe, expect, it } from "vitest";
import {
  boundingBox,
  coarseDistanceKm,
  coarseDistanceLabel,
  DEFAULT_RADIUS_KM,
  GLASS_BAND,
  glassBandFor,
  haversineKm,
  withinGlassBand,
  withinRadius,
} from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it("matches a known London distance (Shoreditch -> Wandsworth ~9-10 km)", () => {
    // 51.5265,-0.0805 (Shoreditch) to 51.4571,-0.1935 (Wandsworth)
    const km = haversineKm(51.5265, -0.0805, 51.4571, -0.1935);
    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(11);
  });

  it("matches a known long-haul distance (London -> Paris ~340 km)", () => {
    const km = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(350);
  });

  it("is symmetric", () => {
    const a = haversineKm(51.5, -0.1, 52.2, 0.1);
    const b = haversineKm(52.2, 0.1, 51.5, -0.1);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("withinRadius", () => {
  it("uses DEFAULT_RADIUS_KM when no radius is given", () => {
    expect(DEFAULT_RADIUS_KM).toBe(10);
    // Shoreditch -> Stratford ~5 km, inside 10
    expect(withinRadius(51.5265, -0.0805, 51.5432, -0.0125)).toBe(true);
    // Shoreditch -> Wandsworth ~11 km, just OUTSIDE the 10 km default
    expect(withinRadius(51.5265, -0.0805, 51.4571, -0.1935)).toBe(false);
    // ...but inside a widened 12 km radius
    expect(withinRadius(51.5265, -0.0805, 51.4571, -0.1935, 12)).toBe(true);
  });

  it("excludes points beyond the radius", () => {
    // ~5 km apart, radius 3 -> excluded
    expect(withinRadius(51.5265, -0.0805, 51.5432, -0.0125, 3)).toBe(false);
  });
});

describe("boundingBox", () => {
  it("contains the exact radius circle it approximates", () => {
    const lat = 51.5;
    const lng = -0.1;
    const r = 10;
    const box = boundingBox(lat, lng, r);
    // A point exactly r km due north must fall inside the box's lat span.
    const northLat = lat + (r / 6371) * (180 / Math.PI);
    expect(northLat).toBeLessThanOrEqual(box.maxLat + 1e-9);
    expect(northLat).toBeGreaterThanOrEqual(lat);
    // Box brackets the centre on all sides.
    expect(box.minLat).toBeLessThan(lat);
    expect(box.maxLat).toBeGreaterThan(lat);
    expect(box.minLng).toBeLessThan(lng);
    expect(box.maxLng).toBeGreaterThan(lng);
  });

  it("every point inside the radius is inside the box (over-selects, never under)", () => {
    const lat = 51.5;
    const lng = -0.1;
    const r = 8;
    const box = boundingBox(lat, lng, r);
    // Sample points on the radius circle in 16 directions.
    for (let i = 0; i < 16; i++) {
      const bearing = (i / 16) * 2 * Math.PI;
      const dLat = (r / 6371) * (180 / Math.PI) * Math.cos(bearing);
      const dLng =
        ((r / 6371) * (180 / Math.PI) * Math.sin(bearing)) /
        Math.cos((lat * Math.PI) / 180);
      const pLat = lat + dLat;
      const pLng = lng + dLng;
      if (withinRadius(lat, lng, pLat, pLng, r)) {
        expect(pLat).toBeGreaterThanOrEqual(box.minLat - 1e-9);
        expect(pLat).toBeLessThanOrEqual(box.maxLat + 1e-9);
        expect(pLng).toBeGreaterThanOrEqual(box.minLng - 1e-9);
        expect(pLng).toBeLessThanOrEqual(box.maxLng + 1e-9);
      }
    }
  });
});

describe("coarseDistance", () => {
  it("buckets sub-km up to 1 and rounds up", () => {
    expect(coarseDistanceKm(0)).toBe(0);
    expect(coarseDistanceKm(0.3)).toBe(1);
    expect(coarseDistanceKm(2.1)).toBe(3);
    expect(coarseDistanceKm(3)).toBe(3);
  });

  it("saturates at 25", () => {
    expect(coarseDistanceKm(40)).toBe(25);
  });

  it("labels read naturally", () => {
    expect(coarseDistanceLabel(0)).toBe("here");
    expect(coarseDistanceLabel(2.4)).toBe("~3 km away");
    expect(coarseDistanceLabel(30)).toBe("25+ km away");
  });
});

describe("glass banding", () => {
  it("GLASS_BAND is 0.75", () => {
    expect(GLASS_BAND).toBe(0.75);
  });

  it("builds a symmetric window around a rated player", () => {
    expect(glassBandFor(3.5)).toEqual({ min: 2.75, max: 4.25 });
  });

  it("returns null for an unrated player (match ANY band)", () => {
    expect(glassBandFor(null)).toBeNull();
  });

  it("withinGlassBand: rated pair inside/outside the band", () => {
    expect(withinGlassBand(3.5, 4.0)).toBe(true); // 0.5 apart
    expect(withinGlassBand(3.5, 4.25)).toBe(true); // exactly 0.75
    expect(withinGlassBand(3.5, 4.5)).toBe(false); // 1.0 apart
  });

  it("withinGlassBand: an unrated player matches anyone", () => {
    expect(withinGlassBand(null, 6.5)).toBe(true);
    expect(withinGlassBand(2.0, null)).toBe(true);
    expect(withinGlassBand(null, null)).toBe(true);
  });
});
