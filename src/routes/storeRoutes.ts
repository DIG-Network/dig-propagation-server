import express from "express";
import {
  headStore,
  getStore,
  putStore,
  storeStatus
} from "../controllers/merkleTreeController";

import { setMnemonic } from "../controllers/configController";
import { verifyMnemonic } from "../middleware/verifyMnemonic";
import { subscribeToStore, unsubscribeToStore } from "../controllers/storeController";


const router = express.Router();

router.post("/unsubscribe", express.json(), unsubscribeToStore);
router.post("/subscribe", express.json(), subscribeToStore);
router.post("/mnemonic", express.json(), setMnemonic);
router.get("/status/:storeId", storeStatus);

// Route to handle HEAD, GET, and PUT requests for /stores/:storeId
router.head("/:storeId", verifyMnemonic, headStore);
router.get("/:storeId/*", getStore);
router.put("/:storeId/*", putStore);


export { router as storeRoutes };
