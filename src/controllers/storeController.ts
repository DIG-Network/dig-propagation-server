import { Request, Response } from "express";
import path from "path";
import fs from "fs";

// @ts-ignore
import { DigNetwork } from "@dignetwork/dig-sdk";
import { getStorageLocation } from "../utils/storage";

export const subscribeToStore = async (req: Request, res: Response): Promise<void> => {
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
    await digNetwork.downloadFiles();

    res.status(200).json({ message: `Subscribing to store ${storeId}` });
  } catch (error) {
    console.error("An error occurred while processing the subscription:", error);
    res.status(500).json({ error: "An error occurred while processing the subscription." });
  }
};

export const unsubscribeToStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.body;

    const pathToStore = path.resolve(getStorageLocation(), "stores", storeId);

    // Remove the store directory
    fs.rmdirSync(pathToStore, { recursive: true });

    res.status(200).json({ message: `Unsubscribed to store ${storeId}` });
  } catch (error) {
    console.error("An error occurred while processing the unsubscription:", error);
    res.status(500).json({ error: "An error occurred while processing the unsubscription." });
  }
};
