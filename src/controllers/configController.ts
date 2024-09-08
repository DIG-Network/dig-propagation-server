import { Request, Response } from "express";
// @ts-ignore
import { Wallet } from "dig-sdk";

export const setMnemonic = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { mnemonic, walletName } = req.body;

    // Check if the mnemonic field is present in the request body
    if (!mnemonic) {
      res.status(400).json({ error: "Mnemonic is required." });
      return;
    }

    // handles validation logic in the function
    await Wallet.importWallet(walletName || "default", mnemonic);

    res.status(200).json({ message: "Mnemonic has been set successfully." });
  } catch (error) {
    console.error("An error occurred while setting the mnemonic:", error);
    res
      .status(500)
      .json({ error: "An error occurred while setting the mnemonic." });
  }
};
