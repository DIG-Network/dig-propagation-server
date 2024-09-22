## Upload Protocol - README

### Overview

This upload protocol manages file uploads securely and efficiently in a distributed storage network. Each upload session is tied to a unique session ID and is managed via a temporary folder with a customizable Time-to-Live (TTL). The protocol validates key ownership using signatures and supports flexible session handling, including file uploads, session commits, and aborts.

### Key Features

- **Session-Based File Uploads**: Each upload occurs within a session that has a unique session ID. Files are uploaded to a temporary directory that has a defined TTL.
- **Key Ownership Validation**: File uploads require nonce-based validation with a key ownership signature to ensure the uploader has write permissions.
- **Session TTL Management**: Sessions are cleaned up automatically after inactivity, or the session TTL can be reset during active file uploads.
- **Commit and Abort Support**: Once files are uploaded, they can either be committed to the store's permanent directory or aborted, deleting all files associated with the session.

### API Endpoints

#### 1. **HEAD /stores/{storeId}**
   **Description**: Check if a store exists and optionally verify if a specific root hash exists in that store.
   - **Query Param**: `hasRootHash` (optional) — Use this query parameter to check if the root hash exists in the store.
   - **Headers Returned**:
     - `x-store-exists`: Indicates whether the store exists (`true` or `false`).
     - `x-has-root-hash`: If the `hasRootHash` query is provided, this header will indicate whether the specific root hash exists (`true` or `false`).

   **Example**:
   ```bash
   HEAD /stores/myStoreId?hasRootHash=12345abcdef
   ```
   The server will return the following headers:
   - `x-store-exists: true`
   - `x-has-root-hash: true` (if the root hash exists)

#### 2. **POST /upload/{storeId}**
   **Description**: Starts an upload session for a store. If the store does not exist, the user will be required to authenticate.
   - **Response**:
     - `sessionId`: A unique identifier for the upload session.

   **Example**:
   ```bash
   POST /upload/myStoreId
   ```
   Response:
   ```json
   {
     "message": "Upload session started for DataStore myStoreId.",
     "sessionId": "12345-abcdef-67890"
   }
   ```

#### 3. **PUT /upload/{storeId}/{sessionId}/{filename}**
   **Description**: Uploads a file to the store within an active session. Each file must be validated with a nonce, key ownership signature, and the uploader's public key.
   - **Headers Required**:
     - `x-key-ownership-sig`: A signature proving key ownership.
     - `x-public-key`: The uploader's public key.
     - `x-nonce`: A unique nonce used to generate the signature.

   **Example**:
   ```bash
   PUT /upload/myStoreId/12345-abcdef-67890/myfile.txt
   ```
   Headers:
   - `x-key-ownership-sig: <signature>`
   - `x-public-key: <public-key>`
   - `x-nonce: <nonce>`

#### 4. **POST /commit/{storeId}/{sessionId}**
   **Description**: Finalizes the upload by moving files from the session's temporary folder to the store's permanent directory.

   **Example**:
   ```bash
   POST /commit/myStoreId/12345-abcdef-67890
   ```
   Response:
   ```json
   {
     "message": "Upload for DataStore myStoreId under session 12345-abcdef-67890 committed successfully."
   }
   ```

#### 5. **POST /abort/{storeId}/{sessionId}**
   **Description**: Aborts the upload session, deletes the temporary session folder, and removes the session from the cache.

   **Example**:
   ```bash
   POST /abort/myStoreId/12345-abcdef-67890
   ```
   Response:
   ```json
   {
     "message": "Upload session 12345-abcdef-67890 for DataStore myStoreId aborted and cleaned up."
   }
   ```

### Example Workflow

1. **Start an Upload Session**:
   - Call the `POST /upload/{storeId}` endpoint to start an upload session.
   - The server responds with a `sessionId` to track the session.

2. **Upload a File**:
   - For each file, send a `PUT /upload/{storeId}/{sessionId}/{filename}` request.
   - Include the required headers (`x-key-ownership-sig`, `x-public-key`, and `x-nonce`).

3. **Commit the Session**:
   - After all files are uploaded, call the `POST /commit/{storeId}/{sessionId}` endpoint to commit the session.

4. **Abort the Session (Optional)**:
   - If you need to abort the session and discard the uploaded files, use the `POST /abort/{storeId}/{sessionId}` endpoint.

