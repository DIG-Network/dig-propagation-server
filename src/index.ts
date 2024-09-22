import fs from "fs";

// @ts-ignore
import { startPropagationServer } from "./server";
import tasks from "./tasks";

tasks.start();
startPropagationServer();
