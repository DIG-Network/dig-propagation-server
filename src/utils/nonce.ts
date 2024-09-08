import crypto from "crypto";

// In-memory storage for nonces
const nonceStore: { [userId: string]: { nonce: string; expires: number } } = {};

// Function to generate and store nonce
export const generateNonce = (userId: string): string => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

  nonceStore[userId] = { nonce, expires };
  return nonce;
};

// Function to validate nonce
export const validateNonce = (userId: string, providedNonce: string): boolean => {
  const nonceData = nonceStore[userId];
  if (!nonceData) return false;

  const { nonce, expires } = nonceData;

  // Check if the nonce matches and is not expired
  if (providedNonce === nonce && Date.now() < expires) {
    // Optionally, delete the nonce after validation to prevent reuse
    delete nonceStore[userId];
    return true;
  }

  return false;
};
