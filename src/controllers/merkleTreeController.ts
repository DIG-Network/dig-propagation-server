import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import NodeCache from "node-cache";
import { getCredentials } from "../utils/authUtils";
import { HttpError } from "../utils/HttpError";
import { generateNonce, validateNonce } from "../utils/nonce";

// @ts-ignore
import { DataStore, Wallet, getStoresList } from "@dignetwork/dig-sdk";
import { pipeline } from "stream";
import { promisify } from "util";
import { getStorageLocation } from "../utils/storage";

const streamPipeline = promisify(pipeline);

// Create a cache instance with 1 minute TTL (time-to-live)
const storeOwnerCache = new NodeCache({ stdTTL: 60 });
const generateCacheKey = (publicKey: string, storeId: string): string => {
  return `${publicKey}_${storeId}`;
};

const digFolderPath = getStorageLocation();

export const storeStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      throw new HttpError(400, "Missing storeId in path parameters.");
    }

    const dataStore = DataStore.from(storeId);
    const synced = await dataStore.isSynced();

    res.status(200).json({ synced });
  } catch (error: any) {
    console.error("Error in storeStatus controller:", error);

    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const errorMessage = error.message || "Failed to process request";

    res.status(statusCode).json({ error: errorMessage });
  }
};

// Controller to handle HEAD requests for /stores/:storeId
export const headStore = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("Received request in headStore controller.");

    // Extract the publicKey from query params if present (optional)
    const publicKey = req.query.publicKey as string | undefined;

    let userNonce: string | null = null;
    if (publicKey) {
      // Generate a nonce if a valid public key is provided
      userNonce = await generateNonce(publicKey);
      console.log("Generated User Nonce for publicKey:", userNonce);
    }

    const { storeId } = req.params;
    console.log("Store ID:", storeId);

    const hasRootHash = req.query.hasRootHash as string | undefined;
    console.log("Has Root Hash Query:", hasRootHash);

    if (!storeId) {
      console.log("Missing path parameters.");
      throw new HttpError(400, "Missing path parameters");
    }

    const dataStore = DataStore.from(storeId);
    console.log("Data Store initialized for Store ID:", storeId);

    // Check if the store exists on this machine
    const storeList = getStoresList();
    const storeExists = storeList.includes(storeId);
    console.log(`Store exists on this machine: ${storeExists}`);

    // Fetch root history and calculate the latest sync status
    const rootHistory = await dataStore.getRootHistory();
    console.log("Root History:", rootHistory);

    const latestRootHash = rootHistory.length > 0 ? rootHistory[rootHistory.length - 1].root_hash : null;
    let isSynced = false;

    if (latestRootHash) {
      // If hasRootHash is provided, compare it to the latest root hash
      if (hasRootHash) {
        const hasRootHashInHistory = rootHistory.some(
          (history) => history.root_hash === hasRootHash && history.synced
        );
        console.log(`Root hash ${hasRootHash} in history and synced:`, hasRootHashInHistory);
        res.setHeader("X-Has-RootHash", hasRootHashInHistory ? "true" : "false");
      }

      // Always check if the store is synced with the latest root hash
      isSynced = rootHistory.some((history) => history.root_hash === latestRootHash && history.synced);
      console.log(`Store is synced with latest root hash: ${isSynced}`);
    }

    // Response headers
    res
      .set({
        "x-store-id": storeId,
        "x-store-exists": storeExists ? "true" : "false",
        "x-synced": isSynced ? "true" : "false",
        ...(userNonce && { "x-nonce": userNonce }),
      })
      .status(200)
      .end();
  } catch (error: any) {
    console.error("Error in headStore controller:", error);

    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const errorMessage = error.message || "Failed to process request";

    res.status(statusCode).json({ error: errorMessage });
  }
};

// Controller to handle GET requests for /stores/:storeId
export const getStore = async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;
    const relativeFilePath = req.params[0]; // This will capture the rest of the path after the storeId

    if (!storeId || !relativeFilePath) {
      res.status(400).send("Missing storeId or file path.");
      return;
    }

    // Construct the full file path
    const fullPath = path.join(
      digFolderPath,
      "stores",
      storeId,
      relativeFilePath
    );

    // Check if the file exists
    if (!fs.existsSync(fullPath)) {
      res.status(404).send("File not found.");
      return;
    }

    // Stream the file to the response
    const fileStream = fs.createReadStream(fullPath);

    // Handle errors during streaming
    fileStream.on("error", (err) => {
      console.error("Error streaming file:", err);
      res.status(500).send("Error streaming file.");
    });

    // Set content type to application/octet-stream for all files
    res.setHeader("Content-Type", "application/octet-stream");

    // Stream the file to the response
    fileStream.pipe(res);
  } catch (error) {
    console.error("Error in getStore controller:", error);
    res.status(500).send("Failed to process the request.");
  }
};

export const putStore = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("Received file upload request.");

    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Basic ")) {
      console.log("Authorization header missing or incorrect format.");
      throw new HttpError(401, "Unauthorized");
    }

    const [providedUsername, providedPassword] = Buffer.from(
      authHeader.split(" ")[1],
      "base64"
    )
      .toString("utf-8")
      .split(":");

    console.log("Authorization credentials extracted.");

    const { storeId } = req.params;
    if (!storeId) {
      console.log("storeId is missing in the path parameters.");
      throw new HttpError(400, "Missing storeId in path parameters.");
    }

    const { username, password } = await getCredentials();

    const storeList = getStoresList();

    // If the store is already tracked by this peer, anyone that has write
    // access to the store (checked further down) can upload updates without authorization since its
    // essentially the same as if an upate was pull from another peer.
    // You only need credentials to track new stores.

    if (
      !storeList.includes(storeId) &&
      (providedUsername !== username || providedPassword !== password)
    ) {
      console.log("Provided credentials do not match stored credentials.");
      throw new HttpError(401, "Unauthorized");
    }

    console.log(`storeId received: ${storeId}`);

    // These parameters are expected to be in the query or headers, not the body for a file upload
    const keyOwnershipSig = req.headers["x-key-ownership-sig"] as string;
    const publicKey = req.headers["x-public-key"] as string;
    const nonce = req.headers["x-nonce"] as string;
    const filename = decodeURIComponent(req.path);

    if (!keyOwnershipSig || !publicKey || !nonce || !filename) {
      console.log("One or more required headers are missing.");
      throw new HttpError(400, "Missing required headers.");
    }

    console.log(
      `Received headers: keyOwnershipSig=${keyOwnershipSig}, publicKey=${publicKey}, nonce=${nonce}, filename=${filename}`
    );

    let fileKey = path.join(filename);

    // Verify key ownership signature
    console.log("Verifying key ownership signature...");
    const validNonce = validateNonce(publicKey, nonce);

    if (!validNonce) {
      console.log("Invalid nonce.");
      throw new HttpError(401, "Invalid nonce.");
    }

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

    // Check store ownership
    console.log("Checking store ownership...");

    const cacheKey = generateCacheKey(publicKey, storeId);
    let isOwner = storeOwnerCache.get<boolean>(cacheKey);

    if (isOwner === undefined) {
      // If not in cache, check ownership and cache the result
      const dataStore = DataStore.from(storeId);
      isOwner = await dataStore.hasMetaWritePermissions(
        Buffer.from(publicKey, "hex")
      );

      // Cache the result for 1 minute (60 seconds)
      storeOwnerCache.set(cacheKey, isOwner);
    } else {
      console.log("Using cached isOwner value for publicKey and storeId:", cacheKey);
      storeOwnerCache.ttl(cacheKey, 60);
    }

    if (!isOwner) {
      console.log("User does not have write access to this store.");
      throw new HttpError(403, "You do not have write access to this store.");
    }

    console.log("User has write access to the store.");

    // Construct the full path where the file should be stored
    const fullPath = path.join(digFolderPath, "stores", fileKey);
    console.log("Saving file to:", fullPath);

    // Ensure the directory exists
    const directory = path.dirname(fullPath);
    if (!fs.existsSync(directory)) {
      console.log("Directory does not exist, creating:", directory);
      fs.mkdirSync(directory, { recursive: true });
    }

    // Stream the file to the destination
    console.log("Streaming file to destination...");
    await streamPipeline(req, fs.createWriteStream(fullPath));

    console.log("File uploaded successfully.");
    res.status(200).json({ message: "File uploaded successfully." });
  } catch (error: any) {
    console.error("Error in putStore controller:", error);

    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const errorMessage = error.message || "Failed to upload the file.";

    res.status(statusCode).json({ error: errorMessage });
  }
};
