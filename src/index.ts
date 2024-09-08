import fs from "fs";

// @ts-ignore
import { STORE_PATH } from "dig-sdk";
import { startPropagationServer } from "./server";
import tasks from "./tasks";

if (!fs.existsSync(STORE_PATH)) {
  fs.mkdirSync(STORE_PATH, { recursive: true });
}

tasks.start();
startPropagationServer();
