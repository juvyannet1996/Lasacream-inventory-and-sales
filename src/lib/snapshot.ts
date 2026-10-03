import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DomainError } from "./errors";
import { authorizationHeader, objectUrl, s3ConfigFromEnv, sha256Hex, type S3Config } from "./s3";

const FETCHER = `
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const msg = JSON.parse(raw);
  const url = new URL(msg.url);
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(url, { method: msg.method, headers: msg.headers }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      const body = Buffer.concat(chunks);
      if (msg.outFile && res.statusCode === 200) fs.writeFileSync(msg.outFile, body);
      process.stdout.write(JSON.stringify({ status: res.statusCode }));
    });
  });
  req.on("error", (error) => {
    process.stdout.write(JSON.stringify({ error: error.message }));
    process.exit(1);
  });
  if (msg.bodyFile) req.end(fs.readFileSync(msg.bodyFile));
  else req.end();
});
`;

function request(method: "GET" | "PUT", config: S3Config, bodyFile?: string, outFile?: string): number {
  const url = objectUrl(config);
  const payloadHash = sha256Hex(bodyFile ? readFileSync(bodyFile) : Buffer.alloc(0));
  const signed = authorizationHeader({
    method,
    url,
    payloadHash,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    now: new Date(),
  });
  const result = spawnSync(process.execPath, ["-e", FETCHER], {
    input: JSON.stringify({
      url: url.toString(),
      method,
      headers: {
        host: signed.signedHeaders.host,
        authorization: signed.authorization,
        "x-amz-content-sha256": signed.payloadHash,
        "x-amz-date": signed.amzDate,
      },
      bodyFile: bodyFile ?? null,
      outFile: outFile ?? null,
    }),
    encoding: "utf8",
    timeout: 30_000,
    env: process.env,
  });
  if (result.error) throw new Error(result.error.message);
  const stdout = result.stdout?.trim();
  if (!stdout) throw new Error(result.stderr?.trim() || "The saved records could not be reached.");
  const parsed = JSON.parse(stdout) as { status?: number; error?: string };
  if (parsed.error || result.status !== 0) throw new Error(parsed.error || "The saved records could not be reached.");
  if (typeof parsed.status !== "number") throw new Error("The saved records could not be reached.");
  return parsed.status;
}

/** Download the stock file. `missing` means this shop has not been saved yet. */
export function downloadDatabase(filename: string, config: S3Config = requiredConfig()): "restored" | "missing" {
  let status: number;
  try {
    status = request("GET", config, undefined, filename);
  } catch {
    throw new DomainError("Saved stock and sales could not be loaded. Try again in a minute.");
  }
  if (status === 404) return "missing";
  if (status !== 200) {
    throw new DomainError("Saved stock and sales could not be loaded. Try again in a minute.");
  }
  return "restored";
}

export function uploadDatabase(filename: string, config: S3Config = requiredConfig()): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = request("PUT", config, filename);
      if (status >= 200 && status < 300) return;
      lastError = new Error(`Upload status ${status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

export function snapshotConfig(): S3Config | null {
  return s3ConfigFromEnv();
}

function requiredConfig(): S3Config {
  const config = s3ConfigFromEnv();
  if (!config) throw new DomainError("Saving is not set up yet.");
  return config;
}
