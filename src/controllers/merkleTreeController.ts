import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getCredentials } from "../utils/authUtils";
import { HttpError } from "../utils/HttpError";
import { DataStore, Wallet } from "@dignetwork/dig-sdk";
import { promisify } from "util";
import { getStorageLocation } from "../utils/storage";
import tmp from "tmp";
import { PassThrough } from "stream";
import NodeCache from "node-cache";
import { generateNonce, validateNonce } from "../utils/nonce";

const digFolderPath = getStorageLocation();
const streamPipeline = promisify(require("stream").pipeline);

// Set the TTL for 5 minutes (in milliseconds)
const sessionTTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const ownerCacheTTL = 3 * 60 * 1000; // Cache expiry for isOwner (3 minutes)

// Cache for tracking session folders and owner permissions
const sessionCache: {
  [key: string]: {
    tmpDir: string;
    cleanup: () => void;
    timer: NodeJS.Timeout;
    resetTtl: () => void;
  };
} = {};
const ownerCache = new NodeCache({ stdTTL: ownerCacheTTL });

/**
 * Creates a session directory with custom TTL logic. Each session has a TTL that can be reset
 * when new files are uploaded to prevent early cleanup.
 *
 * @param {number} ttl - The TTL (Time-to-Live) in milliseconds before the session is cleaned up.
 * @returns {string} sessionId - A unique session identifier.
 */
function createSessionWithTTL(ttl: number): string {
  const tmpDirInfo = tmp.dirSync({ unsafeCleanup: true });
  const sessionId = uuidv4();

  const resetTtl = () => {
    clearTimeout(sessionCache[sessionId]?.timer);
    sessionCache[sessionId].timer = setTimeout(() => {
      cleanupSession(sessionId);
    }, ttl);
  };

  sessionCache[sessionId] = {
    tmpDir: tmpDirInfo.name,
    cleanup: tmpDirInfo.removeCallback,
    timer: setTimeout(() => cleanupSession(sessionId), ttl),
    resetTtl,
  };

  return sessionId;
}

/**
 * Cleans up the session directory after the TTL expires or the upload is complete.
 *
 * @param {string} sessionId - The unique session ID to clean up.
 */
function cleanupSession(sessionId: string): void {
  const session = sessionCache[sessionId];
  if (session) {
    session.cleanup(); // Remove the temporary directory
    clearTimeout(session.timer); // Clear the timeout
    delete sessionCache[sessionId]; // Remove the session from the cache
    console.log(`Session ${sessionId} cleaned up.`);
  }
}

/**
 * Check if a store exists and optionally check if a root hash exists (HEAD /stores/{storeId})
 * If the store exists, set headers indicating that the store and optionally the root hash exist.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const headStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const { hasRootHash } = req.query; // Extract optional query param hasRootHash

    if (!storeId) {
      throw new HttpError(400, "Missing storeId in the request.");
    }

    const storePath = path.join(digFolderPath, "stores", storeId);

    // Check if the store exists
    const storeExists = fs.existsSync(storePath);
    res.setHeader("x-store-exists", storeExists ? "true" : "false");

    // If the store exists and hasRootHash is provided, check for the root hash
    if (storeExists && hasRootHash) {
      const rootHashPath = path.join(storePath, `${hasRootHash}.dat`);

      // Check if the file for the root hash exists in the store's directory
      const rootHashExists = fs.existsSync(rootHashPath);
      res.setHeader("x-has-root-hash", rootHashExists ? "true" : "false");
    }

    // End the response (since HEAD requests shouldn't have a body)
    res.status(200).end();
  } catch (error: any) {
    console.error("Error checking store existence:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).end();
  }
};

/**
 * Start an upload session for a DataStore (POST /upload/{storeId})
 * Creates a unique session folder under the DataStore for each upload session.
 * Authentication is only required if the DataStore does not already exist.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const startUploadSession = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId } = req.params;
    const uploadPath = path.join(digFolderPath, "stores", storeId);

    // Check if the DataStore directory already exists
    const storeExists = fs.existsSync(uploadPath);

    // If the store does not exist, require authentication
    if (!storeExists) {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Basic ")) {
        throw new HttpError(401, "Unauthorized");
      }

      const [providedUsername, providedPassword] = Buffer.from(
        authHeader.split(" ")[1],
        "base64"
      )
        .toString("utf-8")
        .split(":");

      const { username, password } = await getCredentials();

      if (providedUsername !== username || providedPassword !== password) {
        throw new HttpError(401, "Unauthorized");
      }
    }

    // Create a unique subdirectory for this upload session with custom TTL
    const sessionId = createSessionWithTTL(sessionTTL);

    res.status(200).json({
      message: `Upload session started for DataStore ${storeId}.`,
      sessionId,
    });
  } catch (error: any) {
    console.error("Error starting upload session:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};

/**
 * Handle the HEAD request for /upload/{storeId}/{sessionId}/{filename}
 * Returns a nonce in the headers for file upload.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const generateFileNonce = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, sessionId, filename } = req.params;

    if (!storeId || !sessionId || !filename) {
      throw new HttpError(400, "Missing required parameters.");
    }

    // Check if the session exists in the cache
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "Upload session not found.");
    }

    // Generate a nonce for the file
    const nonceKey = `${storeId}_${sessionId}_${filename}`;
    console.log(`Generating nonce for file: ${nonceKey}`);
    const nonce = generateNonce(nonceKey);
    console.log(`Nonce generated: ${nonce}`);

    // Set the nonce in the headers
    res.setHeader("x-nonce", nonce);

    // Return 200 status with no body, as per HEAD request specification
    res.status(200).end();
  } catch (error: any) {
    console.error("Error generating nonce:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).end();
  }
};

/**
 * Upload a file to a DataStore (PUT /upload/{storeId}/{sessionId}/{filename})
 * Each session has a unique session folder under the DataStore.
 * Each file has a nonce, key ownership signature, and public key that must be validated before upload.
 * Uploading a file continuously resets the session TTL during the upload.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const uploadFile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, sessionId, filename } = req.params;

    // Get nonce, publicKey, and keyOwnershipSig from the headers
    const keyOwnershipSig = req.headers["x-key-ownership-sig"] as string;
    const publicKey = req.headers["x-public-key"] as string;
    const nonce = req.headers["x-nonce"] as string;

    if (!keyOwnershipSig || !publicKey || !nonce) {
      throw new HttpError(
        400,
        "Missing required headers: nonce, publicKey, or keyOwnershipSig."
      );
    }

    const nonceKey = `${storeId}_${sessionId}_${filename}`;
    console.log(`Validating nonce for file: ${nonceKey}`, nonce);

    if (!validateNonce(`${storeId}_${sessionId}_${filename}`, nonce)) {
      throw new HttpError(401, "Invalid nonce.");
    }

    // Validate the key ownership signature using the nonce
    const wallet = await Wallet.load("default");
    const isSignatureValid = await wallet.verifyKeyOwnershipSignature(
      nonce,
      keyOwnershipSig,
      publicKey
    );

    if (!isSignatureValid) {
      console.log("Key ownership signature is invalid.");
      throw new HttpError(401, "Invalid key ownership signature.");
    }

    console.log("Key ownership signature verified successfully.");

    // Check if the user has write permissions to the store
    const cacheKey = `${publicKey}_${storeId}`;
    let isOwner = ownerCache.get<boolean>(cacheKey);

    if (isOwner === undefined) {
      // If the value isn't in the cache, check the actual permissions
      const dataStore = DataStore.from(storeId);
      isOwner = await dataStore.hasMetaWritePermissions(
        Buffer.from(publicKey, "hex")
      );
      ownerCache.set(cacheKey, isOwner); // Cache the result for future requests
    }

    if (!isOwner) {
      throw new HttpError(403, "You do not have write access to this store.");
    }

    // Check if the session exists in the cache and reset the TTL if found
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "Session not found or expired.");
    }

    // Reset the TTL periodically while streaming the file
    const passThrough = new PassThrough();
    passThrough.on("data", () => {
      session.resetTtl(); // Reset the TTL on each chunk of data
      ownerCache.ttl(cacheKey, ownerCacheTTL); // Extend cache TTL
    });

    // Proceed with file upload
    const filePath = path.join(session.tmpDir, filename);
    const fileStream = fs.createWriteStream(filePath);

    await streamPipeline(req.pipe(passThrough), fileStream);

    res.status(200).json({
      message: `File ${filename} uploaded to DataStore ${storeId} under session ${sessionId}.`,
    });
  } catch (error: any) {
    console.error("Error uploading file:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};

/**
 * Commit the upload for a DataStore (POST /commit/{storeId}/{sessionId})
 * Moves files from the session's temporary upload folder to the store directory.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const commitUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, sessionId } = req.params;
    const finalDir = path.join(digFolderPath, "stores", storeId);

    // Retrieve the session information from the cache
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "No upload session found or session expired.");
    }

    const sessionUploadDir = session.tmpDir;

    // Ensure that the final store directory exists
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    // Move all files from the temporary session directory to the final store directory
    fs.readdirSync(sessionUploadDir).forEach((file) => {
      const sourcePath = path.join(sessionUploadDir, file);
      const destinationPath = path.join(finalDir, file);
      fs.renameSync(sourcePath, destinationPath);
    });

    // Clean up the session folder after committing
    cleanupSession(sessionId);

    res
      .status(200)
      .json({
        message: `Upload for DataStore ${storeId} under session ${sessionId} committed successfully.`,
      });
  } catch (error: any) {
    console.error("Error committing upload:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};

/**
 * Abort the upload session for a DataStore (POST /abort/{storeId}/{sessionId})
 * Deletes the session's temporary upload folder and its contents.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const abortUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, sessionId } = req.params;

    // Retrieve the session information from the cache
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "No upload session found or session expired.");
    }

    // Clean up the session folder and remove it from the cache
    fs.rmSync(session.tmpDir, { recursive: true, force: true });
    cleanupSession(sessionId);

    res
      .status(200)
      .json({
        message: `Upload session ${sessionId} for DataStore ${storeId} aborted and cleaned up.`,
      });
  } catch (error: any) {
    console.error("Error aborting upload session:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};
