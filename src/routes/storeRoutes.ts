import express from "express";
import {
  headStore,
  startUploadSession,
  uploadFile,
  commitUpload,
  abortUpload,
  generateFileNonce
} from "../controllers/merkleTreeController";

import { setMnemonic } from "../controllers/configController";
import { verifyMnemonic } from "../middleware/verifyMnemonic";
import { subscribeToStore, unsubscribeToStore } from "../controllers/storeController";

const router = express.Router();

router.post("/unsubscribe", express.json(), unsubscribeToStore);
router.post("/subscribe", express.json(), subscribeToStore);
router.post("/mnemonic", express.json(), setMnemonic);

// Head request to check if a store exists
router.head("/:storeId", verifyMnemonic, headStore);

// Start an upload session for a store
router.post("/upload/:storeId", verifyMnemonic, startUploadSession);

// Upload a file to a store's session (PUT /upload/{storeId}/{sessionId}/{filename})
router.head("/upload/:storeId/:sessionId/:filename", generateFileNonce);

// Upload a file to a store's session (PUT /upload/{storeId}/{sessionId}/{filename})
router.put("/upload/:storeId/:sessionId/:filename", uploadFile);

// Commit an upload (POST /commit/{storeId}/{sessionId})
router.post("/commit/:storeId/:sessionId", commitUpload);

// Abort an upload session (POST /abort/{storeId}/{sessionId})
router.post("/abort/:storeId/:sessionId", abortUpload);


export { router as storeRoutes };
