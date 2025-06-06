import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { SimplifiedStroke } from "./types.js";
import { hasValue, isStrokeWeights } from "@/utils/identity.js";
import { generateCSSShorthand, isVisible, parsePaint } from "@/utils/common.js";
export function buildSimplifiedStrokes(n: FigmaDocumentNode): SimplifiedStroke {
  const strokes: SimplifiedStroke = { colors: [] };
  if (hasValue("strokes", n) && Array.isArray(n.strokes) && n.strokes.length) {
    strokes.colors = n.strokes.filter(isVisible).map(parsePaint);
  }

  if (hasValue("strokeWeight", n) && typeof n.strokeWeight === "number" && n.strokeWeight > 0) {
    strokes.strokeWeight = `${n.strokeWeight}px`;
  }

  if (hasValue("strokeDashes", n) && Array.isArray(n.strokeDashes) && n.strokeDashes.length) {
    strokes.strokeDashes = n.strokeDashes;
  }

  if (hasValue("individualStrokeWeights", n, isStrokeWeights)) {
    strokes.strokeWeight = generateCSSShorthand(n.individualStrokeWeights);
  }

  return strokes;
}
