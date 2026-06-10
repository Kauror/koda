export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/õ/g, "o")
    .replace(/ü/g, "u")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
