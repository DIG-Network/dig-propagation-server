import _ from "lodash";
import { SimpleIntervalJob, Task } from "toad-scheduler";
import {
  getStoresList,
  DataStore,
  DigNetwork,
  NconfManager,
  ServerCoin,
  StoreMonitorRegistry,
} from "@dignetwork/dig-sdk";
import { Mutex } from "async-mutex";
import { RootHistoryItem } from "@dignetwork/dig-sdk/dist/types";
const mutex = new Mutex();

const PUBLIC_IP_KEY = "publicIp";
const nconfManager = new NconfManager("config.json");

const missingSyncPool = new Set<string>();

// -------------------------
// Helper Functions
// -------------------------

/**
 * Attempts to synchronize a store from the network.
 * @param storeId - The ID of the store to synchronize.
 */
const syncStoreFromNetwork = async (storeId: string): Promise<void> => {
  try {
    console.log(`Attempting to sync store ${storeId} from the network...`);

    const digNetwork = new DigNetwork(storeId);
    await digNetwork.syncStoreFromPeers();

    const dataStore = await DataStore.from(storeId);
    await dataStore.fetchCoinInfo();

    const rootHistory = await dataStore.getRootHistory();

    const lastRoot = _.last(rootHistory);
    if (!lastRoot) {
      console.error(`No root history found for store ${storeId}.`);
      return;
    }

    // If not synced put in the pool to keep trying
    if ((lastRoot as RootHistoryItem).synced) {
      missingSyncPool.delete(storeId);
      console.log(`Store ${storeId} synchronized successfully.`);
    } else {
      missingSyncPool.add(storeId);
      console.log(`Store ${storeId} could not synchronize, will try again in a few minutes.`);
    }

    
  } catch (error: any) {
    console.warn(
      `Initial sync attempt failed for ${storeId}: ${error.message}`
    );
    if (error.message.includes("No DIG Peers found")) {
      console.error(`No DIG Peers found for store ${storeId}. Skipping...`);
      return;
    }
  }
};

/**
 * Ensures that the server coin exists and is valid for a specific store.
 * @param storeId - The ID of the store.
 * @param publicIp - The public IP address of the node.
 */
const ensureServerCoin = async (
  storeId: string,
  publicIp: string
): Promise<void> => {
  try {
    const serverCoin = new ServerCoin(storeId);
    await serverCoin.ensureServerCoinExists(publicIp);
    await serverCoin.meltOutdatedEpochs(publicIp);
  } catch (error: any) {
    console.error(
      `Failed to ensure server coin for store ${storeId}: ${error.message}`
    );
  }
};

const processMissingSyncPool = async (): Promise<void> => {
  for (const storeId of missingSyncPool) {
    try {
      await syncStoreFromNetwork(storeId);
    } catch (error: any) {
      console.error(`Failed to sync store ${storeId}: ${error.message}`);
    }
  }
};

// -------------------------
// Initialization Function
// -------------------------

/**
 * Initializes all stores by registering them with the store monitor and syncing them.
 */
const initializeStoreMonitor = async (): Promise<void> => {
  try {
    console.log("Initializing stores monitor...");
    const storeMonitor = StoreMonitorRegistry.getInstance();

    const storeList = getStoresList();

    const publicIp: string | null | undefined =
      await nconfManager.getConfigValue(PUBLIC_IP_KEY);

    // Register each store with the store monitor
    storeList.forEach((storeId) => {
      const serverCoin = new ServerCoin(storeId);
      storeMonitor.registerStore(storeId, async () => {
        if (publicIp) {
          await serverCoin.ensureServerCoinExists(publicIp);
        }

        console.log(`Store update detected for ${storeId}. Syncing...`);
        await syncStoreFromNetwork(storeId);

        if (publicIp) {
          await serverCoin.ensureServerCoinExists(publicIp);
        }
      });
    });

    // Attempt to sync each store initially
    for (const storeId of storeList) {
      await syncStoreFromNetwork(storeId);
    }

    console.log("All stores have been initialized and synchronized.");
  } catch (error: any) {
    console.error(`Initialization failed: ${error.message}`);
  }
};

// -------------------------
// Scheduler Task
// -------------------------

/**
 * Defines the scheduled task to sync stores and ensure server coins.
 */
const syncStoresTask = new Task("sync-stores", async () => {
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
        releaseMutex();
        return; // Exit the task if we can't retrieve the public IP
      }

      await processMissingSyncPool();

      for (const storeId of storeList) {
        try {
          if (publicIp) {
            await ensureServerCoin(storeId, publicIp);
          } else {
            console.warn(
              `Skipping server coin check for store ${storeId} due to missing public IP.`
            );
          }
        } catch (error: any) {
          console.error(`Failed to sync store ${storeId}: ${error.message}`);
        }
      }

      await ServerCoin.meltUntrackedStoreCoins();

      console.log("Sync-stores task completed.");
    } catch (error: any) {
      console.error(`Error in sync-stores task: ${error.message}`);
    } finally {
      releaseMutex();
    }
  }
});

// -------------------------
// Scheduler Job Setup
// -------------------------

const job = new SimpleIntervalJob(
  {
    minutes: 5,
    runImmediately: true,
  },
  syncStoresTask,
  { id: "sync-stores", preventOverrun: true }
);

setTimeout(() => {
  initializeStoreMonitor();
}, 5000);

export default job;
