import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { storeRoutes } from "./routes";
import { Tls } from "chia-server-coin";
import { verifyCredentials } from './middleware/verifyMnemonic';

const caCertPath = path.join(__dirname, "ssl", "ca", "chia_ca.crt");
const caKeyPath = path.join(__dirname, "ssl", "ca", "chia_ca.key");

const serverCertPath = path.join(__dirname, "ssl", "dig", "server.cert");
const serverKeyPath = path.join(__dirname, "ssl", "dig", "server.key");

if (!fs.existsSync(caCertPath) || !fs.existsSync(caKeyPath)) {
  throw new Error("CA certificate or key not found.");
}

// Ensure the directory for server certificate and key exists
const serverDir = path.dirname(serverCertPath);
if (!fs.existsSync(serverDir)) {
  fs.mkdirSync(serverDir, { recursive: true });
}

if (!fs.existsSync(serverCertPath) || !fs.existsSync(serverKeyPath)) {
  // Ensure that the Tls class will generate certs correctly, signed by your CA.
  new Tls(serverCertPath, serverKeyPath);
  console.log("Server certificate and key generated successfully.");
}

const caCert = fs.readFileSync(caCertPath);
const serverCert = fs.readFileSync(serverCertPath);
const serverKey = fs.readFileSync(serverKeyPath);

const app = express();
const PORT = Number(process.env.PORT) || 4159;

// Apply store routes
app.use(verifyCredentials);
app.use("/", storeRoutes);

const serverOptions = {
  key: serverKey,
  cert: serverCert,
  ca: caCert,
  requestCert: true, // Require client certificate
  rejectUnauthorized: true, // Reject unauthorized clients
};

// Create the HTTPS server
const server = https.createServer(serverOptions, app);

// Export both the app and the server
export { app, server, PORT };
