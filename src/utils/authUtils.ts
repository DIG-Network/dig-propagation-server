import {HttpError } from "./HttpError";

export const getCredentials = async () => {
    const username = process.env.DIG_USERNAME;
    const password = process.env.DIG_PASSWORD;
    
    if (!username || !password) {
      throw new HttpError(500, "Propagation Server does not have credentials set, please add them to the ENV to use this feature.");
    }
  
    return { username, password };
  };