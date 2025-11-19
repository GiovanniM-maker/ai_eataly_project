/**
 * Model information and descriptions
 * ONLY 2 MODELS SUPPORTED
 */
import { MODEL_CAPABILITIES } from '../lib/modelCapabilities.js';

export const MODEL_INFO = {
  "gemini-2.5-flash": "Gemini 2.5 Flash: modello avanzato per generazione testo, multimodale, ottimo per task generali con buon tradeoff tra qualità e velocità.",
  "gemini-2.5-flash-image": "Nano Banana: modello per generazione immagini tramite Vertex AI. Genera immagini da prompt testuali."
};

/**
 * All available models (2 models only)
 */
export const ALL_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-image"
];

/**
 * Default model
 */
export const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Get model display name
 */
export const getModelDisplayName = (model) => {
  const capabilities = MODEL_CAPABILITIES[model];
  if (capabilities) {
    return capabilities.label;
  }
  const names = {
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-image": "Nano Banana"
  };
  return names[model] || model;
};

/**
 * Check if a model is an image model
 */
export const isImageModel = (model) => {
  const capabilities = MODEL_CAPABILITIES[model];
  return capabilities?.type === 'image';
};

/**
 * Check if a model is a text model
 */
export const isTextModel = (model) => {
  const capabilities = MODEL_CAPABILITIES[model];
  return capabilities?.type === 'text';
};

/**
 * Check if a model is a Gemini model
 */
export const isGeminiModel = (model) => {
  return model && model.startsWith("gemini-");
};
