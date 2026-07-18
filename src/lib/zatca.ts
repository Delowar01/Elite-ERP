import "server-only";
import { createHash } from "crypto";
import QRCode from "qrcode";

// ZATCA Phase 1 (simplified tax invoice) QR: base64 of TLV-encoded
// tag1 seller name · tag2 seller VAT number · tag3 timestamp · tag4 total (VAT-inclusive) · tag5 VAT amount.
function tlv(tag: number, value: string): Buffer {
  const v = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export function buildZatcaTlv(input: {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  total: string;
  vatTotal: string;
}): string {
  return Buffer.concat([
    tlv(1, input.sellerName),
    tlv(2, input.vatNumber),
    tlv(3, input.timestamp),
    tlv(4, input.total),
    tlv(5, input.vatTotal),
  ]).toString("base64");
}

export function invoiceHashOf(tlvBase64: string): string {
  return createHash("sha256").update(tlvBase64).digest("hex");
}

export async function zatcaQrDataUrl(tlvBase64: string): Promise<string> {
  return QRCode.toDataURL(tlvBase64, { margin: 0, width: 168, errorCorrectionLevel: "M" });
}
