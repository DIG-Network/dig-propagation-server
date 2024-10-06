import { SimpleIntervalJob, Task } from "toad-scheduler";

// @ts-ignore
import { getPublicHost, NconfManager } from "@dignetwork/dig-sdk";
import { Mutex } from "async-mutex";

const mutex = new Mutex();

const PUBLIC_Host_KEY = "publicHost";

// Function to save the public IP address to nconf
const savePublicIp = async (): Promise<void> => {
  const nconfManager = new NconfManager("config.json");
  try {
    const publicHost = await getPublicHost();
    if (publicHost) {
      await nconfManager.setConfigValue(PUBLIC_Host_KEY, publicHost);
      console.log(`Public host saved: ${publicHost}`);
    } else {
      console.warn("No public host found.");
    }
  } catch (error: any) {
    console.error(`Failed to retrieve host address: ${error.message}`);
  }
};

// Task that runs at a regular interval to save the public IP
const task = new Task("save-public-ip", async () => {
  if (!mutex.isLocked()) {
    const releaseMutex = await mutex.acquire();
    try {
      console.log("Starting save-public-ip task...");
      await savePublicIp();
      console.log("save-public-ip task completed.");
    } finally {
      releaseMutex();
    }
  }
});

const job = new SimpleIntervalJob(
  {
    days: 7,
    runImmediately: true,
  },
  task,
  { id: "save-public-ip", preventOverrun: true }
);

export default job;
