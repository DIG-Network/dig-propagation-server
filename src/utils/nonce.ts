import crypto from "crypto";
import NodeCache from "node-cache";

// Create a new NodeCache instance with a 5-minute TTL for nonces
const nonceCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 60 }); // Check every minute for expired entries

/**
 * Function to generate and store nonce in NodeCache.
 * @param {string} userId - Unique identifier for the user (or session).
 * @returns {string} - The generated nonce.
 */
export const generateNonce = (nonceKey: string): string => {
  const nonce = crypto.randomBytes(16).toString("hex");

  // Store the nonce in the cache with userId as the key
  nonceCache.set(nonceKey, nonce);

  return nonce;
};

/**
 * Function to validate the provided nonce.
 * @param {string} userId - Unique identifier for the user (or session).
 * @param {string} providedNonce - The nonce provided for validation.
 * @returns {boolean} - True if the nonce is valid, otherwise false.
 */
export const validateNonce = (nonceKey: string, providedNonce: string): boolean => {
  const cachedNonce = nonceCache.get<string>(nonceKey);

  if (cachedNonce && cachedNonce === providedNonce) {
    nonceCache.del(nonceKey); // Delete nonce after successful validation
    return true;
  }

  return false;
};
