import { describe, expect, it } from "vitest";
import { buildIcsEvent } from "@/lib/ics";
import { appleMapsUrl, googleMapsUrl, venueAppleMapsUrl, venueDirectionsUrl } from "@/lib/directions";

describe("buildIcsEvent", () => {
  it("renders a single-VEVENT VCALENDAR with UTC basic-format dates", () => {
    const ics = buildIcsEvent({
      uid: "cuatro-session-abc@cuatro.app",
      title: "Tuesday Night Lot · CUATRO",
      location: "Powerleague Shoreditch",
      startsAt: new Date("2026-08-04T20:00:00.000Z"),
      endsAt: new Date("2026-08-04T21:30:00.000Z"),
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:cuatro-session-abc@cuatro.app");
    expect(ics).toContain("DTSTART:20260804T200000Z");
    expect(ics).toContain("DTEND:20260804T213000Z");
    expect(ics).toContain("SUMMARY:Tuesday Night Lot · CUATRO");
    expect(ics).toContain("LOCATION:Powerleague Shoreditch");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes commas, semicolons and backslashes in text fields", () => {
    const ics = buildIcsEvent({
      uid: "u@cuatro.app",
      title: "Foo; Bar, Baz\\Qux",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-01T01:00:00.000Z"),
    });
    expect(ics).toContain("SUMMARY:Foo\\; Bar\\, Baz\\\\Qux");
  });

  it("omits LOCATION when no location is given", () => {
    const ics = buildIcsEvent({
      uid: "u@cuatro.app",
      title: "No venue",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-01T01:00:00.000Z"),
    });
    expect(ics).not.toContain("LOCATION:");
  });
});

describe("googleMapsUrl / venueDirectionsUrl", () => {
  it("URL-encodes the query", () => {
    expect(googleMapsUrl("Powerleague Shoreditch, London")).toBe(
      "https://maps.google.com/?q=Powerleague%20Shoreditch%2C%20London",
    );
  });

  it("prefers a venue's address over its bare name", () => {
    const url = venueDirectionsUrl({ name: "Powerleague Shoreditch", address: "Braithwaite St, E1 6GJ" });
    expect(url).toBe(googleMapsUrl("Braithwaite St, E1 6GJ"));
  });

  it("falls back to the name when there's no address, and to null when there's no venue", () => {
    expect(venueDirectionsUrl({ name: "Powerleague Shoreditch" })).toBe(googleMapsUrl("Powerleague Shoreditch"));
    expect(venueDirectionsUrl(null)).toBeNull();
  });
});

describe("appleMapsUrl / venueAppleMapsUrl", () => {
  it("URL-encodes the query against maps.apple.com", () => {
    expect(appleMapsUrl("Powerleague Shoreditch, London")).toBe(
      "https://maps.apple.com/?q=Powerleague%20Shoreditch%2C%20London",
    );
  });

  it("prefers a venue's address over its bare name, same as venueDirectionsUrl", () => {
    const url = venueAppleMapsUrl({ name: "Powerleague Shoreditch", address: "Braithwaite St, E1 6GJ" });
    expect(url).toBe(appleMapsUrl("Braithwaite St, E1 6GJ"));
  });

  it("falls back to the name when there's no address, and to null when there's no venue", () => {
    expect(venueAppleMapsUrl({ name: "Powerleague Shoreditch" })).toBe(appleMapsUrl("Powerleague Shoreditch"));
    expect(venueAppleMapsUrl(null)).toBeNull();
  });
});
