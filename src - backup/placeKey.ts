// Unique, order-independent key for a Place, needed because the catalog has
// 11 duplicate Place Names (same object, two different crops). Content-derived
// from the Place's Name + its imageset's tile URL (crops always have distinct
// URLs) rather than a positional index, so it stays stable across catalog
// re-parses and doesn't depend on traversal order lining up between the two
// independent WTML walks (Folder/Place tree in extractPlaces, flat
// querySelectorAll("Place") in loadMetadata).
import { Place } from "@wwtelescope/engine";

export function placeKey(place: Place): string {
  const iset = place.get_studyImageset() ?? place.get_backgroundImageset();
  const name = place.get_name();
  const url = iset?.get_url() ?? "";
  return url ? `${name}::${url}` : name;
}
