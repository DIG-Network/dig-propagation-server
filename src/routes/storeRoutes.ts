import express from "express";
import {
  headStore,
  startUploadSession,
  uploadFile,
  commitUpload,
  abortUpload,
  generateFileNonce,
  headFile,
  fetchFile,
} from "../controllers/merkleTreeController";
import rateLimit from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { setMnemonic } from "../controllers/configController";
import { verifyMnemonic } from "../middleware/verifyMnemonic";
import {
  subscribeToStore,
  unsubscribeToStore,
  syncStoreFromRequestor,
  getUserIpAddresses
} from "../controllers/storeController";
import { verifyAuthorization } from "../middleware/verifyAuthorization";

// Rate limiting for file downloads, based on storeId and catch-all path
const rateLimitForStore = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 100, // Max 100 requests per window
  keyGenerator: (req: Request) => {
    const { storeId } = req.params;
    const catchallPath = req.params[0] || ''; // Ensure it's always a string
    return `${req.ip}-${storeId}-${catchallPath}`;
  },
  message: (req: Request) =>
    `Too many requests for store ${req.params.storeId}. Please try again later.`,
  headers: true,
});

// Rate limiting for upload session creation, limiting per IP
const rateLimitUploadSessions = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 10, // Max 10 requests per window
  message: "Too many upload sessions created. Please try again later.",
  headers: true,
});

const router = express.Router();

router.post("/unsubscribe", express.json(), verifyAuthorization, unsubscribeToStore);
router.post("/subscribe", express.json(), verifyAuthorization, subscribeToStore);
router.post("/mnemonic", express.json(), verifyAuthorization, setMnemonic);
router.post("/update", express.json(), syncStoreFromRequestor);
router.post("/peer", express.json(), getUserIpAddresses);

// Head request to check if a store exists
router.head("/:storeId", verifyMnemonic, headStore);

// Start an upload session for a store, rate limit the session creation
router.post("/upload/:storeId", rateLimitUploadSessions, verifyMnemonic, startUploadSession);

// Upload a file to a store's session (HEAD /upload/{storeId}/{sessionId}/{filename})
router.head("/upload/:storeId/:sessionId/*", generateFileNonce);

// Upload a file to a store's session (PUT /upload/{storeId}/{sessionId}/{filename})
router.put("/upload/:storeId/:sessionId/*", uploadFile);

// Commit an upload (POST /commit/:storeId/:sessionId)
router.post("/commit/:storeId/:sessionId", commitUpload);

// Abort an upload session (POST /abort/:storeId/:sessionId)
router.post("/abort/:storeId/:sessionId", abortUpload);

// Apply rate limiting per storeId and catch-all path for file fetching
router.head("/fetch/:storeId/:roothash/*", headFile);
router.get("/fetch/:storeId/*", rateLimitForStore, fetchFile);

export { router as storeRoutes };
