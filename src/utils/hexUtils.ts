export const hexToUtf8 = (hex: string): string => {
    return Buffer.from(hex, "hex").toString("utf-8");
  };
  