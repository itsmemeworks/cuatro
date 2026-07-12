/**
 * Registers the pmtiles:// protocol on maplibre exactly ONCE per app
 * lifecycle. maplibregl.addProtocol throws if the same name is registered
 * twice, and the Atlas has two GL surfaces that each need it (the live map and
 * the patch mini-map). They import the SAME maplibre-gl module instance
 * (webpack dedupes), so a module-level guard here covers both — a per-component
 * guard would let one surface register and a later remount of the other throw.
 *
 * Takes the maplibregl instance as a param so this module never imports
 * maplibre-gl itself (the mini-map dynamic-imports maplibre to stay SSR-safe;
 * this module must not drag it into any server bundle). pmtiles's Protocol is
 * import-safe (no window at module scope).
 */
import type maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

let registered = false;

export function registerPmtilesProtocol(gl: typeof maplibregl): void {
  if (registered) return;
  const protocol = new Protocol();
  gl.addProtocol("pmtiles", protocol.tile);
  registered = true;
}
