/**
 * PlantUML rendering via the official public server.
 *
 * Encoding: plantuml-encoder (npm) → plantuml.com SVG endpoint.
 *
 * Limitation: requires internet connectivity.  The preview will show an
 * error message when offline; the last successfully fetched SVG is kept in
 * memory so an already-loaded diagram can still be exported as PDF.
 */
import plantumlEncoder from "plantuml-encoder";

const SERVER_BASE = "https://www.plantuml.com/plantuml/svg";

/**
 * Encode PlantUML source text to the server-compatible format.
 * @param {string} text  Raw PlantUML source (may or may not start with @startuml)
 * @returns {string}     Encoded string ready to append to the server URL
 */
export function encodePlantUML(text) {
  const src = text.trim().startsWith("@") ? text : `@startuml\n${text}\n@enduml`;
  return plantumlEncoder.encode(src);
}

/**
 * Fetch an SVG string from the PlantUML public server.
 * @param {string} text  Raw PlantUML source
 * @returns {Promise<string>} SVG markup as a string
 * @throws {Error} on network failure or non-2xx response
 */
export async function renderPlantUML(text) {
  const encoded = encodePlantUML(text);
  const url = `${SERVER_BASE}/${encoded}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PlantUML server responded with ${res.status}`);
  }
  return res.text();
}

/**
 * Build the direct image URL for a PlantUML diagram.
 * Useful for <img> fallback when fetch is not available.
 * @param {string} text  Raw PlantUML source
 * @returns {string} Full URL to the rendered SVG
 */
export function plantUMLImageUrl(text) {
  return `${SERVER_BASE}/${encodePlantUML(text)}`;
}
