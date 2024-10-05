import fs from "fs";
import path from 'path';
import { SimpleIntervalJob, Task } from "toad-scheduler";
import {
  getStoresList,
  DataStore,
  DigNetwork,
  NconfManager,
  ServerCoin,
  DigPeer,
  withTimeout
} from "@dignetwork/dig-sdk";
import { Mutex } from "async-mutex";
import { getStorageLocation } from "../utils/storage";

const STORE_PATH = path.join(getStorageLocation(), "stores");

const mutex = new Mutex();

const PUBLIC_IP_KEY = "publicIp";
const nconfManager = new NconfManager("config.json");

// Map to track which peerIps have been checked for each rootHash
const checkedPeersMap: Map<string, Set<string>> = new Map();

/**
 * Process a single peer: check for rootHash and ping update if necessary.
 * @param peerIp - The IP address of the peer.
 * @param rootHash - The current rootHash to check against.
 * @param checkedPeers - The set of peers already checked for the rootHash.
 */
const processPeer = async (peerIp: string, storeId: string, rootHash: string, checkedPeers: Set<string>): Promise<void> => {
  try {
    const digPeer = new DigPeer(peerIp, storeId);
    const hasRootHash = await withTimeout(digPeer.contentServer.hasRootHash(rootHash), 5000, `Dig Peer: ${peerIp} took to long to respond to head request`);

    if (hasRootHash) {
      console.log(`Dig Peer ${peerIp} already has rootHash ${rootHash}. Marking as checked.`);
      checkedPeers.add(peerIp); // Mark as checked only if peer has the rootHash
    } else {
      console.log(`Dig Peer ${peerIp} does not have rootHash ${rootHash}. Pinging update.`);
      await digPeer.propagationServer.pingUpdate(rootHash);
      // Do NOT mark as checked if peer lacks the rootHash
    }
  } catch (error: any) {
    console.error(`Error interacting with Dig Peer: ${peerIp}: ${error.message}`);
  }
};

/**
 * Clean the checkedPeersMap to retain only the current rootHash.
 * @param currentRootHash - The rootHash to retain in the map.
 */
const cleanCheckedPeersMap = (currentRootHash: string): void => {
  for (const [rootHash, _] of checkedPeersMap.entries()) {
    if (rootHash !== currentRootHash) {
      checkedPeersMap.delete(rootHash);
      console.log(`Removed outdated rootHash ${rootHash} from checkedPeersMap.`);
    }
  }
};

/**
 * Handle a store that is already synced by checking peers for updates sequentially.
 * @param storeId - The ID of the synced store.
 * @param serverCoin - The ServerCoin instance associated with the store.
 */
const handleSyncedStore = async (storeId: string, serverCoin: ServerCoin): Promise<void> => {
  try {
    const dataStore = await DataStore.from(storeId);
    const rootHistory = await dataStore.getRootHistory();

    if (rootHistory.length === 0) {
      console.warn(`No root history found for store ${storeId}. Skipping peer checks.`);
      return;
    }

    // Get the current rootHash from the last entry of rootHistory
    const currentRootHashObj = rootHistory[rootHistory.length - 1];
    const currentRootHash = currentRootHashObj.root_hash;
    console.log(`Current rootHash for store ${storeId}: ${currentRootHash}`);

    // Clean checkedPeersMap to only retain peers checked for the current rootHash
    cleanCheckedPeersMap(currentRootHash);

    // Initialize the set for the current rootHash if not present
    if (!checkedPeersMap.has(currentRootHash)) {
      checkedPeersMap.set(currentRootHash, new Set<string>());
      console.log(`Initialized checkedPeersMap for current rootHash ${currentRootHash}.`);
    }

    const checkedPeers = checkedPeersMap.get(currentRootHash)!;

    // Pass the checkedPeers as the blocklist to getActiveEpochPeers
    const blocklist = Array.from(checkedPeers);
    const peerIps: string[] = await serverCoin.getActiveEpochPeers(blocklist);
    console.log(`Active epoch peers for store ${storeId}:`, peerIps);

    if (peerIps.length === 0) {
      console.log(`No new peers to process for rootHash ${currentRootHash} in store ${storeId}.`);
      return;
    }

    // Process peers one at a time sequentially
    for (const peerIp of peerIps) {
      if (checkedPeers.has(peerIp)) {
        console.log(`Peer ${peerIp} has already been checked for rootHash ${currentRootHash}. Skipping.`);
        continue;
      }

      await processPeer(peerIp, storeId, currentRootHash, checkedPeers);
    }

    console.log(`Completed processing peers for rootHash ${currentRootHash} in store ${storeId}.`);

  } catch (error: any) {
    console.error(`Error handling synced store ${storeId}: ${error.message}`);
  }
};

/**
 * Synchronize a single store based on its sync status.
 * @param storeId - The ID of the store to synchronize.
 * @param serverCoin - The ServerCoin instance associated with the store.
 */
const synchronizeStore = async (storeId: string, serverCoin: ServerCoin): Promise<void> => {
  console.log(`Starting synchronization for store ${storeId}...`);

  const isSynced = await isStoreSynced(storeId);

  if (isSynced) {
    console.log(`Store ${storeId} is synced. Proceeding with peer checks.`);
    await handleSyncedStore(storeId, serverCoin);
  } else {
    console.log(`Store ${storeId} is not synced. Initiating synchronization from peers.`);
    await syncStoreFromNetwork(storeId);
  }
};

/**
 * Check if the store is synced by verifying root history entries.
 * @param storeId - The ID of the store to check.
 * @returns A boolean indicating whether the store is up to date.
 */
const isStoreSynced = async (storeId: string): Promise<boolean> => {
  console.log(`Checking synchronization status for store ${storeId}...`);
  const dataStore = await DataStore.from(storeId);

  const rootHistory = await dataStore.getRootHistory();
  const storePath = path.join(STORE_PATH, storeId);

  if (!fs.existsSync(storePath)) {
    console.log(`Store path not found for store ${storeId}. Considering it as not synced.`);
    return false;
  }

  // Check if any entry in rootHistory has synced = false
  const hasUnsyncedEntries = rootHistory.some(entry => entry.synced === false);

  if (hasUnsyncedEntries) {
    console.log(`Store ${storeId} has unsynced entries in root history.`);
    return false;
  } else {
    console.log(`All entries in root history for store ${storeId} are synced.`);
    return true;
  }
};

/**
 * Synchronize the store from the network.
 * @param storeId - The ID of the store to synchronize.
 */
const syncStoreFromNetwork = async (storeId: string): Promise<void> => {
  try {
    console.log(`Attempting to sync store ${storeId} from the network...`);
    const digNetwork = new DigNetwork(storeId);
    await digNetwork.syncStoreFromPeers();
    console.log(`Successfully synced store ${storeId} from peers.`);
  } catch (error: any) {
    console.warn(
      `Initial sync attempt failed for ${storeId}: ${error.message}`
    );
    if (error.message.includes("No DIG Peers found")) {
      console.error(`No DIG Peers found for store ${storeId}. Skipping...`);
      return;
    }
    // Optionally, implement retry logic or additional error handling here
  }
};

/**
 * Finalize the synchronization process for a store.
 * @param storeId - The ID of the store to finalize.
 */
const finalizeStoreSync = async (storeId: string): Promise<void> => {
  try {
    console.log(`Finalizing sync for store ${storeId}...`);
    const dataStore = await DataStore.from(storeId);
    await dataStore.fetchCoinInfo();
    console.log(`Finalization complete for store ${storeId}.`);
  } catch (error: any) {
    console.error(`Error in finalizing store ${storeId}: ${error.message}`);
  }
};

/**
 * Main task to synchronize all stores.
 */
const task = new Task("sync-stores", async () => {
  if (!mutex.isLocked()) {
    const releaseMutex = await mutex.acquire();

    try {
      console.log("Starting sync-stores task...");

      const storeList = getStoresList();
      let publicIp: string | null | undefined;

      try {
        publicIp = await nconfManager.getConfigValue(PUBLIC_IP_KEY);
        if (publicIp) {
          console.log(`Retrieved public IP from configuration: ${publicIp}`);
        } else {
          console.warn(
            "No public IP found in configuration, skipping server coin creation."
          );
        }
      } catch (error: any) {
        console.error(
          `Failed to retrieve public IP from configuration: ${error.message}`
        );
        return; // Exit early; mutex will be released in finally
      }

      for (const storeId of storeList) {
        try {
          if (publicIp) {
            const serverCoin = new ServerCoin(storeId);
            await serverCoin.ensureServerCoinExists(publicIp);

            // Synchronize the store based on its sync status
            await synchronizeStore(storeId, serverCoin);

            // After synchronization, ensure the server coin is updated
            await serverCoin.ensureServerCoinExists(publicIp);
          } else {
            console.warn(
              `Skipping server coin operations for store ${storeId} due to missing public IP.`
            );

            // Even if public IP is missing, you might still want to synchronize the store
            await synchronizeStore(storeId, new ServerCoin(storeId));
          }

          // Finalize synchronization
          await finalizeStoreSync(storeId);
        } catch (error: any) {
          console.error(`Failed to synchronize store ${storeId}: ${error.message}`);
        }
      }

      await ServerCoin.meltUntrackedStoreCoins();

      console.log("Sync-stores task completed.");
    } catch (error: any) {
      console.error(`Error in sync-stores task: ${error.message}`);
    } finally {
      releaseMutex(); // Ensure the mutex is always released here
    }
  } else {
    console.log("Sync-stores task is already running. Skipping this run.");
  }
});


// Schedule the task to run every 60 seconds, starting immediately
const job = new SimpleIntervalJob(
  {
    seconds: 60,
    runImmediately: true,
  },
  task,
  { id: "sync-stores", preventOverrun: true }
);

export default job;
