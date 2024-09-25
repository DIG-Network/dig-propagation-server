import { getCredentials } from "../utils/authUtils";
import { Request, Response, NextFunction } from "express";

export const verifyAuthorization = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const credentials = await getCredentials();

    if (
      !credentials ||
      credentials.password === "CHANGEME" ||
      credentials.username === "CHANGEME"
    ) {
      return res
        .status(500)
        .send(
          "The propagation server does not have a valid username and password set. Please set the DIG_USERNAME and DIG_PASSWORD environment variables."
        );
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      // No Authorization header or it's not Basic Auth
      res.setHeader("WWW-Authenticate", 'Basic realm="Access to the site", charset="UTF-8"');
      return res.status(401).send("Unauthorized: Missing Basic Auth header");
    }

    // Decode base64 credentials
    const base64Credentials = authHeader.split(" ")[1];
    const decodedCredentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
    const [username, password] = decodedCredentials.split(":");

    if (!username || !password) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Access to the site", charset="UTF-8"');
      return res.status(401).send("Unauthorized: Invalid Basic Auth format");
    }

    // Compare credentials
    if (username !== credentials.username || password !== credentials.password) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Access to the site", charset="UTF-8"');
      return res.status(401).send("Unauthorized: Invalid username or password");
    }

    next(); // Credentials are valid; proceed to the next middleware
  } catch (error) {
    console.error("Error in verifyCredentials middleware:", error);
    return res
      .status(500)
      .send("An error occurred while verifying the credentials.");
  }
};

