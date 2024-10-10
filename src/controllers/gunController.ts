// gunController.ts

import { gun } from '../app';
import * as storeController from '../controllers/storeController';
import * as merkleTreeController from '../controllers/merkleTreeController';
import { Request, Response } from 'express';
import { match } from 'path-to-regexp';
import { Writable, PassThrough } from 'stream';

// Define your route mappings
const routeDefinitions = [
  // StoreController routes
  { method: 'POST', path: '/subscribe', handler: storeController.subscribeToStore },
  { method: 'POST', path: '/unsubscribe', handler: storeController.unsubscribeToStore },
  { method: 'POST', path: '/update', handler: storeController.syncStoreFromRequestor },
  { method: 'POST', path: '/peer', handler: storeController.getUserIpAddresses },
  { method: 'GET', path: '/diagnostics/ping', handler: storeController.pingPeer },
  { method: 'POST', path: '/diagnostics/bandwidth', handler: storeController.uploadTest },

  // MerkleTreeController routes
  { method: 'HEAD', path: '/:storeId', handler: merkleTreeController.headStore },
  { method: 'POST', path: '/upload/:storeId', handler: merkleTreeController.startUploadSession },
  { method: 'HEAD', path: '/upload/:storeId/:sessionId/*', handler: merkleTreeController.generateFileNonce },
  { method: 'PUT', path: '/upload/:storeId/:sessionId/*', handler: merkleTreeController.uploadFile },
  { method: 'POST', path: '/commit/:storeId/:sessionId', handler: merkleTreeController.commitUpload },
  { method: 'POST', path: '/abort/:storeId/:sessionId', handler: merkleTreeController.abortUpload },
  { method: 'HEAD', path: '/fetch/:storeId/:roothash/*', handler: merkleTreeController.headFile },
  { method: 'GET', path: '/fetch/:storeId/*', handler: merkleTreeController.fetchFile },
  // Add more routes from your storeRoutes.ts as needed
];


// Listen for incoming requests on the 'requests' node
gun.get('requests').map().on(async (data: any, key: string) => {
  if (data && data.requestId && !data.handled) {
    // Mark as handled to prevent reprocessing
    data.handled = true;
    gun.get('requests').get(key).put({ handled: true });

    const { requestId, route, method, isStream } = data;

    console.log(`Received request ${requestId} for route ${route} with method ${method}`);

    // Find the matching route definition
    const matchedRoute = routeDefinitions.find((rd) => {
      if (rd.method !== method) return false;
      const matcher = match(rd.path, { decode: decodeURIComponent });
      return matcher(route) !== false;
    });

    if (matchedRoute) {
      const matcher = match(matchedRoute.path, { decode: decodeURIComponent });
      const matchResult = matcher(route);

      const params = matchResult ? matchResult.params : {};

      // Construct mock Request and Response objects
      const req = {
        method: method || 'GET',
        body: data.body || {},
        params: params || {},
        query: data.query || {},
        ip: data.ip || '0.0.0.0',
        headers: data.headers || {},
        gunRequestId: requestId, // Add requestId to req for later use
      } as Partial<Request>;

      let res: Partial<Response>;

      if (isStream) {
        // Handle streaming requests
        if (method === 'PUT' || method === 'POST') {
          // Streaming Upload (Client to Server)
          const writableStream = new PassThrough(); // Use PassThrough stream

          // Receive chunks from the client
          receiveStreamFromClient(requestId, writableStream)
            .then(() => {
              // Once the stream ends, call the handler
              // @ts-ignore
              req['stream'] = writableStream; // Attach the stream to req
              res = createGunResponse(requestId);
              matchedRoute.handler(req as Request, res as Response);
            })
            .catch((error) => {
              console.error(`Error receiving stream from client:`, error);
              gun.get(`responses/${requestId}`).put({ body: { error: 'Stream error' }, statusCode: 500 });
            });
        } else if (method === 'GET') {
          // Streaming Download (Server to Client)
          res = createGunStreamResponse(requestId);

          // Call the handler, which should pipe data to res
          matchedRoute.handler(req as Request, res as Response);
        } else {
          // Unsupported method for streaming
          gun.get(`responses/${requestId}`).put({ body: { error: 'Unsupported method for streaming' }, statusCode: 405 });
        }
      } else {
        // Non-streaming request
        res = createGunResponse(requestId);
        try {
          // Call the controller function
          await matchedRoute.handler(req as Request, res as Response);
        } catch (error) {
          console.error(`Error handling route ${route}:`, error);
          if (res.status) {
            res.status(500).json({ error: 'Internal server error' });
          } 
         
        }
      }
    } else {
      console.error(`No handler found for route ${route} with method ${method}`);
      // Send back 404 response
      gun.get(`responses/${requestId}`).put({ body: { error: 'Not Found' }, statusCode: 404 });
    }
  }
});

/**
 * Function to receive a stream from the client via Gun.js chunks
 */
function receiveStreamFromClient(requestId: string, writableStream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    let chunkIndex = 0;

    const receiveChunk = () => {
      const chunkNode = gun.get(`chunks/${requestId}/${chunkIndex}`);
      chunkNode.once((data: any) => {
        if (data && data.data) {
          const chunk = Buffer.from(data.data, 'base64');
          writableStream.write(chunk, (err) => {
            if (err) {
              reject(err);
            } else {
              chunkIndex++;
              receiveChunk();
            }
          });
        } else if (data && data.end) {
          writableStream.end(() => {
            resolve();
          });
        } else {
          // Wait and try again
          setTimeout(receiveChunk, 100);
        }
      });
    };

    receiveChunk();
  });
}

/**
 * Function to create a mock Response object for streaming downloads
 */
function createGunStreamResponse(requestId: string): Response {
  let chunkIndex = 0;
  const headers: { [key: string]: string | number | readonly string[] } = {};

  const res: Partial<Response> = {
    statusCode: 200,

    status: function (code: number): Response {
      this.statusCode = code;
      return this as Response;
    },

    setHeader: function (field: string, value: string | number | readonly string[]): Response {
      headers[field.toLowerCase()] = value;
      return this as Response;
    },

    // @ts-ignore
    getHeader: function (field: string): string | number | readonly string[] | undefined {
      return headers[field.toLowerCase()];
    },

    // Not used for streaming, but must exist
    json: function (body: any) {
      return this as Response;
    },

    send: function (body: any) {
      return this as Response;
    },

    // For streaming download (Server to Client)
    // @ts-ignore
    write: function (chunk: any, encoding?: string, callback?: (error: Error | null | undefined) => void): boolean {
      // Send data to client via Gun.js chunks
      const chunkNode = gun.get(`chunks/${requestId}/${chunkIndex}`);
      chunkNode.put({ data: chunk.toString('base64') });
      chunkIndex++;
      if (callback) callback(null);
      return true;
    },

    // @ts-ignore
    end: function (chunk?: any, encoding?: BufferEncoding, callback?: () => void): Response {
      if (chunk && this.write) {
        if (encoding) {
          this.write(chunk, encoding, () => {});
        }
        this.write(chunk, "base64", () => {});
      }
      // Signal the end of the stream
      const endNode = gun.get(`chunks/${requestId}/${chunkIndex}`);
      endNode.put({ end: true, headers, statusCode: this.statusCode });
      if (callback) callback();
      return this as Response;
    },

    // Implement other methods as no-ops if necessary
  };

  return res as Response;
}

/**
 * Create a mock Response object for non-streaming responses
 */
function createGunResponse(requestId: string): Response {
  const headers: { [key: string]: string | number | readonly string[] } = {};

  const res: Partial<Response> = {
    statusCode: 200,

    status: function (code: number): Response {
      this.statusCode = code;
      return this as Response;
    },

    setHeader: function (field: string, value: string | number | readonly string[]): Response {
      headers[field.toLowerCase()] = value;
      return this as Response;
    },

    // @ts-ignore
    getHeader: function (field: string): string | number | readonly string[] | undefined {
      return headers[field.toLowerCase()];
    },

    json: function (body: any): Response {
      // Send response back via Gun.js
      gun.get(`responses/${requestId}`).put({ body, statusCode: this.statusCode, headers });
      return this as Response;
    },

    send: function (body: any): Response {
      // Send response back via Gun.js
      gun.get(`responses/${requestId}`).put({ body, statusCode: this.statusCode, headers });
      return this as Response;
    },

    // Implement other methods as no-ops if necessary
  };

  return res as unknown as Response;
}