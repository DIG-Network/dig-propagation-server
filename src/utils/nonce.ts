import crypto from "crypto";
import { DigCache } from '@dignetwork/dig-sdk'

// 5-minute TTL for nonces
const nonceCache = new DigCache({ stdTTL: 10 * 60  });

/**
 * Function to generate and store nonce in DigCache.
 * @param {string} userId - Unique identifier for the user (or session).
 * @returns {string} - The generated nonce.
 */
export const generateNonce = async (nonceKey: string): Promise<string> => {
  const nonce = crypto.randomBytes(16).toString("hex");

  // Store the nonce in the cache with userId as the key
  await nonceCache.set(nonceKey, nonce);

  return nonce;
};

/**
 * Function to validate the provided nonce.
 * @param {string} userId - Unique identifier for the user (or session).
 * @param {string} providedNonce - The nonce provided for validation.
 * @returns {boolean} - True if the nonce is valid, otherwise false.
 */
export const validateNonce = async (nonceKey: string, providedNonce: string): Promise<boolean> => {
  const cachedNonce = await nonceCache.get<string>(nonceKey);

  if (cachedNonce && cachedNonce === providedNonce) {
    nonceCache.del(nonceKey); // Delete nonce after successful validation
    return true;
  }

  return false;
};
