import { server, PORT } from "./app";

const startPropagationServer = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`DIG Propagation Server started on port ${PORT}`);
        resolve();  // Resolve the promise when the server starts successfully
      });

      server.on("error", (error) => {
        console.error("Error occurred on the server:", error);
        reject(error);  // Reject the promise if an error occurs during operation
      });

      server.on("close", () => {
        console.log("DIG Propagation Server has been closed.");
        resolve();  // Resolve the promise when the server is closed
      });
    } catch (error) {
      reject(error);  // Catch and reject any synchronous errors
    }
  });
};

export { startPropagationServer };
