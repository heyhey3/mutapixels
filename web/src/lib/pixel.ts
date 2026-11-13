/**
 * Shared pixel identity colors.
 *
 * Gene colors are the validated dark categorical palette (slots 1-8, in the
 * documented order) from the data-viz reference. They are used as borders and
 * tints; the trait name/number always carries the identity too.
 */
export const GENE_TRAITS = [
  { key: "body", name: "Body", short: "BODY", color: "#3987e5" },
  { key: "species", name: "Species", short: "SPEC", color: "#d95926" },
  { key: "eyes", name: "Eyes", short: "EYES", color: "#199e70" },
  { key: "mouth", name: "Mouth", short: "MOUTH", color: "#c98500" },
  { key: "accessory", name: "Accessory", short: "ACC", color: "#d55181" },
  { key: "palette", name: "Palette", short: "HUE", color: "#008300" },
  { key: "aura", name: "Aura", short: "AURA", color: "#9085e9" },
  { key: "pattern", name: "Pattern", short: "PAT", color: "#e66767" },
] as const;

/** Matches the renderer's palette order in server/src/index.ts. */
export const PIXEL_ACCENTS = [
  "#7fe7c4",
  "#ff9f6e",
  "#9d8cff",
  "#7fd1ff",
  "#ff7fa8",
  "#e8c56a",
  "#a8e063",
  "#d8d8d8",
] as const;

export function pixelAccent(genome: number[] | undefined): string {
  return PIXEL_ACCENTS[(genome?.[5] ?? 0) % PIXEL_ACCENTS.length];
}

export function rarityClass(rarity: number): string {
  if (rarity >= 4) return "gold";
  if (rarity >= 3) return "violet";
  return "";
}

export function outcomeClass(outcome: string): string {
  switch (outcome) {
    case "common":
      return "outcome-common";
    case "rare":
      return "outcome-rare";
    case "epic":
      return "outcome-epic";
    case "legendary":
      return "outcome-legendary";
    case "none":
      return "outcome-none";
    default:
      return "outcome-common";
  }
}

export function outcomeTone(outcome: string): string {
  switch (outcome) {
    case "none":
      return "none";
    case "rare":
      return "rare";
    case "epic":
      return "epic";
    case "legendary":
      return "legendary";
    default:
      return "common";
  }
}
