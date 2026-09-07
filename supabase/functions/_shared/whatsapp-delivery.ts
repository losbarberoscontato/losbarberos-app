import type { DeliveryOutcome } from "./whatsapp-contracts.ts";

export async function sendEvolutionText(
  sender: {
    gateway_base_url: string;
    gateway_api_key: string;
    gateway_instance_id: string;
  },
  number: string,
  text: string,
  request: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  try {
    const response = await request(
      `${sender.gateway_base_url.replace(/\/$/, "")}/message/sendText/${
        encodeURIComponent(sender.gateway_instance_id)
      }`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: sender.gateway_api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ number: number.replace(/^\+/, ""), text }),
      },
    );
    // Only an explicit rate-limit refusal is safe to retry automatically.
    if (response.status === 429) {
      return { status: "RETRY", code: "PROVIDER_RATE_LIMIT" };
    }
    if (
      response.status >= 400 && response.status < 500 && response.status !== 408
    ) return { status: "FAILED", code: "PROVIDER_REJECTED" };
    if (!response.ok) {
      return { status: "SEND_UNKNOWN", code: "PROVIDER_UNCERTAIN" };
    }
    const body = await response.json() as {
      key?: { id?: unknown };
      messages?: { id?: unknown }[];
    };
    const id = body?.key?.id ?? body?.messages?.[0]?.id;
    return typeof id === "string" && id.length > 0
      ? { status: "SUBMITTED", providerMessageId: id }
      : { status: "SEND_UNKNOWN", code: "PROVIDER_MESSAGE_ID_MISSING" };
  } catch {
    return { status: "SEND_UNKNOWN", code: "PROVIDER_TIMEOUT_OR_NETWORK" };
  }
}

export function validateImage(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length > 10 * 1024 * 1024 || bytes.length < 12) {
    throw new Error("INVALID_IMAGE_SIZE");
  }
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  ) {
    let offset = 2;
    let frame = false;
    while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        frame = view.getUint16(offset + 5) > 0 &&
          view.getUint16(offset + 7) > 0;
      }
      if (marker === 0xda && frame) return "image/jpeg";
      offset += 2 + size;
    }
  }
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    bytes.length >= 45 && ascii(12, 16) === "IHDR" &&
    view.getUint32(8) === 13 && view.getUint32(16) > 0 && view.getUint32(20) > 0
  ) {
    let offset = 8;
    let data = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset);
      if (offset + size + 12 > bytes.length) break;
      const kind = ascii(offset + 4, offset + 8);
      if (kind === "IDAT" && size > 0) data = true;
      if (
        kind === "IEND" && size === 0 && data && offset + 12 === bytes.length
      ) return "image/png";
      offset += size + 12;
    }
  }
  if (
    ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" &&
    view.getUint32(4, true) + 8 === bytes.length
  ) {
    let offset = 12;
    let image = false;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > bytes.length) break;
      if (["VP8 ", "VP8L"].includes(ascii(offset, offset + 4)) && size >= 5) {
        image = true;
      }
      offset += 8 + size + (size % 2);
    }
    if (image && offset === bytes.length) return "image/webp";
  }
  throw new Error("INVALID_IMAGE_CONTENT");
}
