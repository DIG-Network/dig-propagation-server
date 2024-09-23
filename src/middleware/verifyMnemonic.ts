// @ts-ignore
import { Wallet } from "@dignetwork/dig-sdk";
import { getCredentials } from "../utils/authUtils";
import { Request, Response, NextFunction } from "express";

export const verifyMnemonic = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const wallet = await Wallet.load("default");
    const mnemonic = await wallet.getMnemonic();

    if (!mnemonic) {
      return res
        .status(500)
        .send(
          "The propagation server does not have a mnemonic set. Please run the cmd `dig remote sync seed`"
        );
    }

    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    return res
      .status(500)
      .send("An error occurred while verifying the mnemonic.");
  }
};

export const verifyCredentials = async (
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

    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .send("An error occurred while verifying the mnemonic.");
  }
};
