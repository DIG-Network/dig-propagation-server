import { Request, Response } from "express";
import path from "path";
import fs from "fs";

// @ts-ignore
import {
  DigNetwork,
  DataStore,
  DigPeer,
  ServerCoin,
  NconfManager,
} from "@dignetwork/dig-sdk";
import { getStorageLocation } from "../utils/storage";
import requestIp from 'request-ip';

export const subscribeToStore = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId } = req.body;

    // Validate that storeId is a 64-character hexadecimal string
    const hexRegex = /^[a-fA-F0-9]{64}$/;
    if (!hexRegex.test(storeId)) {
      res.status(400).json({
        error: "Invalid storeId. Must be a 64-character hexadecimal string.",
      });
      return;
    }

    const storePath = path.resolve(getStorageLocation(), "stores", storeId);

    // Ensure the directory exists
    fs.mkdirSync(storePath, { recursive: true });

    // Create an instance of DigNetwork and pull files from the network
    const digNetwork = new DigNetwork(storeId);
    await digNetwork.syncStoreFromPeers();

    const nconfManager = new NconfManager("config.json");
    const publicIp: string | null | undefined =
      await nconfManager.getConfigValue("publicIp");

    if (publicIp) {
      const serverCoin = new ServerCoin(storeId);
      await serverCoin.ensureServerCoinExists(publicIp);
    }

    res.status(200).json({ message: `Subscribing to store ${storeId}` });
  } catch (error) {
    console.error(
      "An error occurred while processing the subscription:",
      error
    );
    res
      .status(500)
      .json({ error: "An error occurred while processing the subscription." });
  }
};

export const unsubscribeToStore = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId } = req.body;

    const pathToStore = path.resolve(getStorageLocation(), "stores", storeId);

    // Remove the store directory
    setTimeout(() => fs.rmdirSync(pathToStore, { recursive: true }), 0);

    res.status(200).json({ message: `Unsubscribed to store ${storeId}` });
  } catch (error) {
    console.error(
      "An error occurred while processing the unsubscription:",
      error
    );
    res.status(500).json({
      error: "An error occurred while processing the unsubscription.",
    });
  }
};

/**
 * Sync the store data from the requestor's IP
 * @param req - Express request object
 * @param res - Express response object
 */
export const syncStoreFromRequestor = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { storeId, rootHash } = req.body;

    // Validate that storeId is a 64-character hexadecimal string
    const hexRegex = /^[a-fA-F0-9]{64}$/;
    if (!storeId || !hexRegex.test(storeId)) {
      res.status(400).json({
        error: "Invalid storeId. Must be a 64-character hexadecimal string.",
      });
      return;
    }

    // Validate that rootHash is a 64-character hexadecimal string
    if (!rootHash || !hexRegex.test(rootHash)) {
      res.status(400).json({
        error: "Invalid rootHash. Must be a 64-character hexadecimal string.",
      });
      return;
    }

    const allStores = await DataStore.getAllStores();

    if (!allStores.includes(storeId)) {
      res.status(400).json({
        error: `Store ${storeId} does not exist.`,
      });
      return;
    }

    // Get the requestor's IP address
    const requestorIp = req.ip;

    // Validate IP address is present
    if (!requestorIp) {
      res.status(400).json({
        error: "Unable to retrieve requestor's IP address.",
      });
      return;
    }

    // Fetch the DataStore and root history
    const dataStore = await DataStore.from(storeId);
    const rootHistory = await dataStore.getRootHistory();

    // Check if the rootHash has already been synced
    const alreadySynced = rootHistory.some(
      (root) => root.root_hash === rootHash && root.synced
    );
    if (alreadySynced) {
      res.status(200).json({ message: "Already Synced" });
      return;
    }

    // Sync the store from the requestor's IP
    const digNetwork = new DigNetwork(storeId);
    const digPeer = new DigPeer(requestorIp, storeId);
    await digNetwork.syncStoreFromPeers(digPeer);

    res
      .status(200)
      .json({ message: `Syncing store ${storeId} from IP ${requestorIp}` });
  } catch (error) {
    console.error(
      "An error occurred while syncing the store from the requestor:",
      error
    );
    res
      .status(500)
      .json({ error: "An error occurred while syncing the store." });
  }
};

/**
 * Get the user's IP addresses (both IPv4 and IPv6) in a well-formatted JSON object.
 * @param req - Express request object
 * @param res - Express response object
 */
export const getUserIpAddresses = (req: Request, res: Response): void => {
  try {
    const clientIp = requestIp.getClientIp(req); // This returns the IP in either IPv4 or IPv6 format

    let ip4: string | null = null;
    let ip6: string | null = null;

    // Determine whether the client IP is IPv4 or IPv6
    if (clientIp) {
      if (clientIp.includes(':')) {
        ip6 = clientIp;
      } else {
        ip4 = clientIp;
      }
    }

    res.status(200).json({
      message: "IP addresses retrieved successfully.",
      ip4,
      ip6,
    });
  } catch (error) {
    console.error("An error occurred while retrieving the IP addresses:", error);
    res.status(500).json({
      error: "An error occurred while retrieving the IP addresses.",
    });
  }
};