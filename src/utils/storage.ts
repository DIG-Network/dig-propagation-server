import os from "os";
import path from "path";
import fs from "fs";

export const getStorageLocation = (): string => {
  // If DIG_STORAGE_LOCATION is set, use it; otherwise, fallback to the default location
  const dir =
    process.env.DIG_FOLDER_PATH || path.join(os.homedir(), ".dig");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};