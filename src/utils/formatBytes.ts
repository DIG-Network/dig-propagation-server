export const formatBytes = (bytes: number): string => {
    const sizes = ["Bytes", "MB", "GB", "TB", "PB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
  };
  