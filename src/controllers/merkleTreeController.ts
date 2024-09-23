import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getCredentials } from "../utils/authUtils";
import { HttpError } from "../utils/HttpError";
import { DataStore, Wallet, DataIntegrityTree } from "@dignetwork/dig-sdk";
import { promisify } from "util";
import { getStorageLocation } from "../utils/storage";
import tmp from "tmp";
import { PassThrough } from "stream";
import NodeCache from "node-cache";
import { generateNonce, validateNonce } from "../utils/nonce";
import Busboy from "busboy";
import fsExtra from "fs-extra";

const digFolderPath = getStorageLocation();
const streamPipeline = promisify(require("stream").pipeline);

// Set the TTL for 5 minutes (in milliseconds)
const sessionTTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const ownerCacheTTL = 3 * 60 * 1000; // Cache expiry for isOwner (3 minutes)

// Cache for tracking session folders and owner permissions
const sessionCache: {
  [key: string]: {
    tmpDir: string;
    roothash?: string;
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
 * @returns {string} sessionId - A unique session identifier.
 */
function createSessionWithTTL(): string {
  const tmpDirInfo = tmp.dirSync({ unsafeCleanup: true });
  const sessionId = uuidv4();

  const resetTtl = () => {
    clearTimeout(sessionCache[sessionId]?.timer);
    sessionCache[sessionId].timer = setTimeout(() => {
      cleanupSession(sessionId);
    }, sessionTTL);
  };

  sessionCache[sessionId] = {
    tmpDir: tmpDirInfo.name,
    cleanup: tmpDirInfo.removeCallback,
    timer: setTimeout(() => cleanupSession(sessionId), sessionTTL),
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

async function merkleIntegrityCheck(
  treePath: string,
  tmpDir: string,
  dataPath: string,
  roothash: string
): Promise<boolean> {
  const rootHashContent = fs.readFileSync(treePath, "utf-8");
  const tree = JSON.parse(rootHashContent);

  // Extract expected sha256 from dataPath
  const expectedSha256 = dataPath.replace("data", "").replace(/\//g, "");
  console.log("expectedSha256", expectedSha256);

  // Find the hexKey in the tree based on matching sha256
  const hexKey = Object.keys(tree.files).find((key) => {
    const fileData = tree.files[key] as { hash: string; sha256: string }; // Inline type definition
    return fileData.sha256 === expectedSha256;
  });

  if (!hexKey) {
    throw new Error(`No matching file found with sha256: ${expectedSha256}`);
  }

  // Validate the integrity with the foreign tree
  const integrity = await DataIntegrityTree.validateKeyIntegrityWithForeignTree(
    hexKey,
    expectedSha256,
    tree,
    roothash,
    path.join(tmpDir, "data")
  );

  console.log("Integrity check result:", integrity);
  return integrity;
}

/**
 * Validates the .dat file by checking if the root hash in the file name
 * matches the root field in the file content and verifies that the root hash
 * is part of the DataStore's root history.
 *
 * @param {string} datFilePath - Path to the .dat file being uploaded.
 * @param {string} storeId - The ID of the DataStore.
 * @throws {HttpError} - Throws an error if validation fails.
 */
export const validateDataFile = async (
  datFilePath: string,
  storeId: string
): Promise<void> => {
  try {
    // Extract rootHash from the file name (e.g., <rootHash>.dat)
    const rootHash = path.basename(datFilePath, ".dat");

    // Ensure the file exists
    if (!fs.existsSync(datFilePath)) {
      throw new HttpError(400, "The .dat file does not exist.");
    }

    // Read the content of the .dat file
    const fileContent = fs.readFileSync(datFilePath, "utf-8");

    const parsedData = JSON.parse(fileContent);

    // Ensure that the "root" field exists in the file
    if (!parsedData.root) {
      throw new HttpError(400, "The .dat file is missing the 'root' field.");
    }

    // Verify that the rootHash in the file name matches the "root" field in the file content
    if (parsedData.root !== rootHash) {
      throw new HttpError(
        400,
        "The rootHash does not match the 'root' field in the file."
      );
    }

    // a tree with zero leaves does not have a root.
    if (parsedData.leaves.length > 0) {
      // Load the dat file into a merkle tree to recalculate the rootHash and
      // verify that the roothash presented belongs to the leaves of this tree.
      const merkleTreeRoot = DataIntegrityTree.getRootOfForeignTree({
        leaves: parsedData.leaves,
      });
      if (merkleTreeRoot !== rootHash) {
        throw new HttpError(400, "Invalid Merkle Root");
      }
    } else {
      if (
        parsedData.root !==
        "0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        throw new HttpError(400, "Invalid Merkle Root");
      } else {
        console.log(
          `.dat file for rootHash ${rootHash} has been successfully validated.`
        );
        return;
      }
    }

    // Initialize the DataStore and retrieve the root history
    // but to represent this we use an empty hash 0000...0
    const dataStore = DataStore.from(storeId);
    const rootHistory = await dataStore.getRootHistory();

    // Check if the rootHash is in the store's root history
    if (!rootHistory.some((entry) => entry.root_hash === rootHash)) {
      throw new HttpError(
        400,
        "The provided rootHash is not part of the store's root history."
      );
    }

    console.log(
      `.dat file for rootHash ${rootHash} has been successfully validated.`
    );
  } catch (error: any) {
    console.error("Error validating .dat file:", error);
    throw new HttpError(
      400,
      error.message || "Failed to validate the .dat file."
    );
  }
};

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

    console.log(`Store Path: ${storePath}`);

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
 * Start an upload session for a DataStore.
 * The request body should include a .dat file with the rootHash name.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const startUploadSession = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId } = req.params;

    // Check if the store directory exists
    const uploadPath = path.join(digFolderPath, "stores", storeId);
    const storeExists = fs.existsSync(uploadPath);

    // If the store doesn't exist, require authentication
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

    // Create session and temp directory for uploaded file storage
    const sessionId = createSessionWithTTL(); // 5 minutes TTL
    const session = sessionCache[sessionId];

    const bb = Busboy({ headers: req.headers });
    let rootHash = "";

    bb.on("file", async (name, file, info) => {
      const { filename } = info;

      // Extract the rootHash from the filename (assuming filename is the rootHash)
      rootHash = path.basename(filename, ".dat");
      session.roothash = rootHash;

      if (!/^[a-fA-F0-9]{64}$/.test(rootHash)) {
        return res.status(400).json({ error: "Invalid rootHash in filename." });
      }

      const tmpDatFilePath = path.join(session.tmpDir, `${rootHash}.dat`);
      const fileStream = fs.createWriteStream(tmpDatFilePath);

      file.pipe(fileStream);

      fileStream.on("finish", async () => {
        try {
          // Validate the uploaded .dat file
          await validateDataFile(tmpDatFilePath, storeId);
          res.status(200).json({
            message: `Upload session started for DataStore ${storeId}.`,
            sessionId,
          });
        } catch (err: any) {
          res.status(400).json({ error: err.message });
        }
      });
    });

    bb.on("error", (err: any) => {
      console.error("Error with file upload:", err);
      res.status(500).json({ error: "Error with file upload." });
    });

    req.pipe(bb);
  } catch (error: any) {
    console.error("Error starting upload session:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};

/**
 * Handle the HEAD request for /upload/{storeId}/{sessionId}/{filename}
 * Returns a nonce in the headers for file upload, and checks if the file already exists.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 */
export const generateFileNonce = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, sessionId } = req.params;
    const filename = req.params[0];

    if (!storeId || !sessionId || !filename) {
      throw new HttpError(400, "Missing required parameters.");
    }

    // Check if the session exists in the cache
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "Upload session not found.");
    }

    // File path in the session's temporary directory
    const tmpFilePath = path.join(session.tmpDir, filename);
    const mainFilePath = path.join(digFolderPath, "stores", storeId, filename);

    // Check if the file exists in either the tmp dir or the main store directory
    const fileExists =
      fs.existsSync(tmpFilePath) || fs.existsSync(mainFilePath);
    res.setHeader("x-file-exists", fileExists ? "true" : "false");

    // If file does not exist, generate a nonce for the file
    if (!fileExists) {
      const nonceKey = `${storeId}_${sessionId}_${filename}`;
      const nonce = generateNonce(nonceKey);
      res.setHeader("x-nonce", nonce);
    }

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
    const { storeId, sessionId } = req.params;
    const filename = req.params[0];

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

    if (!validateNonce(`${storeId}_${sessionId}_${filename}`, nonce)) {
      throw new HttpError(401, "Invalid nonce.");
    }

    // Validate the key ownership signature using the nonce
    const isSignatureValid = await Wallet.verifyKeyOwnershipSignature(
      nonce,
      keyOwnershipSig,
      publicKey
    );

    if (!isSignatureValid) {
      throw new HttpError(401, "Invalid key ownership signature.");
    }

    // Check if the user has write permissions to the store
    const cacheKey = `${publicKey}_${storeId}`;
    let isOwner = ownerCache.get<boolean>(cacheKey);

    if (isOwner === undefined) {
      const dataStore = DataStore.from(storeId);
      isOwner = await dataStore.hasMetaWritePermissions(
        Buffer.from(publicKey, "hex")
      );
      ownerCache.set(cacheKey, isOwner);
    }

    if (!isOwner) {
      throw new HttpError(403, "You do not have write access to this store.");
    }

    // Check if the session exists in the cache and reset the TTL if found
    const session = sessionCache[sessionId];
    if (!session) {
      throw new HttpError(404, "Session not found or expired.");
    }

    // Use Busboy to handle file uploads
    const bb = Busboy({ headers: req.headers });

    bb.on("file", async (_fieldname, file, info) => {
      // Reset TTL periodically while streaming the file
      const passThrough = new PassThrough();
      passThrough.on("data", () => {
        session.resetTtl();
        ownerCache.ttl(cacheKey, ownerCacheTTL); // Extend cache TTL
      });

      // Path where the file will be stored temporarily
      const filePath = path.join(session.tmpDir, filename);

      // Ensure the directory exists before writing the file
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const fileStream = fs.createWriteStream(filePath);

      // Stream the file to disk
      await streamPipeline(file.pipe(passThrough), fileStream);

      // Load the rootHash.dat file for this session
      const rootHashDatPath = path.join(
        session.tmpDir,
        `${session.roothash}.dat`
      );
      if (!fs.existsSync(rootHashDatPath)) {
        throw new HttpError(400, "rootHash.dat file is missing.");
      }

      if (filename.includes("data/")) {
        if (
          !(await merkleIntegrityCheck(
            rootHashDatPath,
            session.tmpDir,
            filename,
            session.roothash || ""
          ))
        ) {
          cleanupSession(sessionId);
          throw new HttpError(400, "File integrity check failed");
        }
      }

      // Confirm file upload
      res.status(200).json({
        message: `File ${filename} uploaded to DataStore ${storeId} under session ${sessionId}.`,
      });
    });

    bb.on("error", (err) => {
      console.error("Error handling file upload:", err);
      res.status(500).json({ error: "File upload failed." });
    });

    req.pipe(bb);
  } catch (error: any) {
    console.error("Error uploading file:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};

/**
 * Commit the upload for a DataStore (POST /commit/{storeId}/{sessionId})
 * Merges files from the session's temporary upload folder to the store directory.
 * If a file already exists, it skips overwriting.
 * Preserves directory structure during the merge.
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

    // Ensure the destination store directory exists
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    // Merge the session upload directory with the final directory
    fsExtra.copySync(sessionUploadDir, finalDir, {
      overwrite: false, // Prevents overwriting existing files
      errorOnExist: false, // No error if file already exists
    });

    // Regenerate the manifest file based on the upload
    const dataStore = DataStore.from(storeId);
    setTimeout(async () => {
      await dataStore.generateManifestFile(finalDir);
    }, 0);

    // Clean up the session folder after merging
    cleanupSession(sessionId);

    res.status(200).json({
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

    const dataStore = DataStore.from(storeId);
    await dataStore.generateManifestFile();

    res.status(200).json({
      message: `Upload session ${sessionId} for DataStore ${storeId} aborted and cleaned up.`,
    });
  } catch (error: any) {
    console.error("Error aborting upload session:", error);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
};
