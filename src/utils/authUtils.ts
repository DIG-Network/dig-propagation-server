import {HttpError } from "./HttpError";
import { Environment } from "@dignetwork/dig-sdk";

export const getCredentials = async () => {
    const username = Environment.DIG_USERNAME;
    const password = Environment.DIG_PASSWORD;
    
    if (!username || !password) {
      throw new HttpError(500, "Propagation Server does not have credentials set, please add them to the ENV to use this feature.");
    }
  
    return { username, password };
  };