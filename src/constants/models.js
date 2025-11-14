/**
 * Model information and descriptions
 */
export const MODEL_INFO = {
  "gemini-2.5-pro": "Il modello più avanzato: ragionamento top, coding avanzato, multimodale (testo+immagini+audio+video), context window enorme (~1M token).",
  "gemini-2.5-flash": "Modello bilanciato, multimodale, ottimo per task generali con buon tradeoff tra qualità e velocità.",
  "gemini-2.5-flash-lite": "Versione leggera: latenza bassissima, costi minimi, multitasking multimodale.",
  "gemini-2.5-flash-image": "Variante specializzata immagini (Nano Banana): generazione, editing, fusioni, multi-image input.",
  "imagen-4": "Modello text-to-image ad alta qualità della famiglia Imagen. Output molto realistici, dettagliati.",
  "imagen-4-ultra": "Versione Ultra: risultati top-tier per rendering fotorealistici, prodotti, ritratti, scenari complessi.",
  "imagen-4-fast": "Variante Fast: generazione rapida a qualità leggermente ridotta."
};

/**
 * All available models
 */
export const ALL_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-image",
  "imagen-4",
  "imagen-4-ultra",
  "imagen-4-fast"
];

/**
 * Default model
 */
export const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Check if a model is an Imagen model (for image generation)
 */
export const isImagenModel = (model) => {
  return model && model.startsWith("imagen-");
};

/**
 * Check if a model is a Gemini model
 */
export const isGeminiModel = (model) => {
  return model && model.startsWith("gemini-");
};

/**
 * Get model display name
 */
export const getModelDisplayName = (model) => {
  const names = {
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "gemini-2.5-flash-image": "Gemini 2.5 Flash Image",
    "imagen-4": "Imagen 4",
    "imagen-4-ultra": "Imagen 4 Ultra",
    "imagen-4-fast": "Imagen 4 Fast"
  };
  return names[model] || model;
};

