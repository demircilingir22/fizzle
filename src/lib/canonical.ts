/**
 * Normalizes any string into a snake_case canonical ID,
 * e.g. "Gomu Gomu no Mi" -> "gomu_gomu_no_mi".
 *
 * Dependency-free so it can be shared by route handlers and client components.
 */
export function toCanonicalId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Canonical IDs for a display name and each part around its parentheses,
 * e.g. "Gomu Gomu no Mi (Gum-Gum Fruit)" -> full name, "gomu_gomu_no_mi", "gum_gum_fruit".
 */
export function nameVariantIds(name: string): string[] {
  return [...new Set([name, ...name.split(/[()]/)].map(toCanonicalId).filter(Boolean))];
}
