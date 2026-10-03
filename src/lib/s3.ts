import { createHash, createHmac } from "node:crypto";

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectKey: string;
};

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = env.BAKESHOP_S3_ENDPOINT?.trim();
  const bucket = env.BAKESHOP_S3_BUCKET?.trim();
  const accessKeyId = env.BAKESHOP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.BAKESHOP_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    region: env.BAKESHOP_S3_REGION?.trim() || "auto",
    accessKeyId,
    secretAccessKey,
    objectKey: env.BAKESHOP_S3_OBJECT_KEY?.trim() || "bakeshop.db",
  };
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Encode one S3 path segment the way Signature Version 4 requires. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function objectUrl(config: S3Config): URL {
  const url = new URL(config.endpoint);
  const key = config.objectKey.split("/").map(encodePathSegment).join("/");
  url.pathname = `/${encodePathSegment(config.bucket)}/${key}`;
  return url;
}

export function authorizationHeader(input: {
  method: string;
  url: URL;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
  extraSignedHeaders?: Record<string, string>;
}): { authorization: string; amzDate: string; payloadHash: string; signedHeaders: Record<string, string> } {
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = input.payloadHash;
  const headerValues: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(input.extraSignedHeaders ?? {}).map(([key, value]) => [key.toLowerCase(), value.trim()]),
    ),
  };
  const names = Object.keys(headerValues).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headerValues[name]}`).join("\n");
  const signedHeaderNames = names.join(";");
  const canonical = [
    input.method.toUpperCase(),
    input.url.pathname,
    input.url.search.replace(/^\?/, ""),
    `${canonicalHeaders}\n`,
    signedHeaderNames,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    amzDate,
    payloadHash,
    signedHeaders: headerValues,
  };
}
