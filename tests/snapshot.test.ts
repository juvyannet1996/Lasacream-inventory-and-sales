import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Worker } from "node:worker_threads";
import { getDb, resetDatabaseForTests } from "../src/lib/db";
import { DomainError } from "../src/lib/errors";
import { createItem, getItem } from "../src/lib/inventory";
import { authorizationHeader } from "../src/lib/s3";

const envKeys = [
  "BAKESHOP_DB",
  "BAKESHOP_SEED",
  "BAKESHOP_S3_ENDPOINT",
  "BAKESHOP_S3_BUCKET",
  "BAKESHOP_S3_REGION",
  "BAKESHOP_S3_ACCESS_KEY_ID",
  "BAKESHOP_S3_SECRET_ACCESS_KEY",
  "BAKESHOP_S3_OBJECT_KEY",
] as const;

const previousEnv = new Map<string, string | undefined>();
let worker: Worker | null = null;
let dir = "";
let objectCount = 0;

function rememberEnv(): void {
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const WORKER = `
const { parentPort } = require("node:worker_threads");
const http = require("node:http");
const objects = new Map();
let failPuts = false;
let failGets = false;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const key = req.url || "";
    if (req.method === "PUT") {
      if (failPuts) {
        res.writeHead(500);
        res.end("no");
        return;
      }
      objects.set(key, Buffer.concat(chunks));
      parentPort.postMessage({ type: "count", count: objects.size });
      res.writeHead(200);
      res.end();
      return;
    }
    if (failGets) {
      res.writeHead(500);
      res.end("no");
      return;
    }
    const found = objects.get(key);
    if (!found) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end(found);
  });
});
parentPort.on("message", (message) => {
  if (message.type === "failPuts") failPuts = message.value;
  if (message.type === "failGets") failGets = message.value;
  if (message.type === "count") parentPort.postMessage({ type: "count", count: objects.size });
});
server.listen(0, "127.0.0.1", () => {
  parentPort.postMessage({ type: "ready", port: server.address().port });
});
`;

function storedCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("No storage server"));
      return;
    }
    const onMessage = (message: { type: string; count?: number }) => {
      if (message.type === "count" && typeof message.count === "number") {
        worker?.off("message", onMessage);
        objectCount = message.count;
        resolve(message.count);
      }
    };
    worker.on("message", onMessage);
    worker.postMessage({ type: "count" });
  });
}

function startWorker(): Promise<number> {
  objectCount = 0;
  worker = new Worker(WORKER, { eval: true });
  worker.on("message", (message: { type: string; count?: number }) => {
    if (message.type === "count" && typeof message.count === "number") objectCount = message.count;
  });
  return new Promise((resolve, reject) => {
    worker!.once("error", reject);
    worker!.on("message", (message: { type: string; port?: number }) => {
      if (message.type === "ready" && message.port) resolve(message.port);
    });
  });
}

describe("saved stock", () => {
  afterEach(async () => {
    resetDatabaseForTests();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    restoreEnv();
  });

  it("matches the AWS signature example", () => {
    const signed = authorizationHeader({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"),
      extraSignedHeaders: { range: "bytes=0-9" },
    });
    assert.equal(
      signed.authorization,
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("keeps a new item after the local file is gone", async () => {
    rememberEnv();
    const port = await startWorker();
    dir = mkdtempSync(path.join(tmpdir(), "bakeshop-"));
    process.env.BAKESHOP_DB = path.join(dir, "bakeshop.db");
    process.env.BAKESHOP_SEED = "0";
    process.env.BAKESHOP_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.BAKESHOP_S3_BUCKET = "lasacream";
    process.env.BAKESHOP_S3_REGION = "auto";
    process.env.BAKESHOP_S3_ACCESS_KEY_ID = "key";
    process.env.BAKESHOP_S3_SECRET_ACCESS_KEY = "secret";
    process.env.BAKESHOP_S3_OBJECT_KEY = "bakeshop.db";
    resetDatabaseForTests();

    const created = createItem({ name: "Sesame", category: "ingredient", icon: "🌱", baseUnit: "g" });
    assert.equal(await storedCount(), 1);

    rmSync(process.env.BAKESHOP_DB, { force: true });
    rmSync(`${process.env.BAKESHOP_DB}-wal`, { force: true });
    rmSync(`${process.env.BAKESHOP_DB}-shm`, { force: true });
    resetDatabaseForTests();

    assert.equal(getItem(created.id)?.name, "Sesame");
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM inventory_items").get() as { c: number };
    assert.equal(row.c, 1);
  });

  it("drops a change that could not be stored", async () => {
    rememberEnv();
    const port = await startWorker();
    dir = mkdtempSync(path.join(tmpdir(), "bakeshop-"));
    process.env.BAKESHOP_DB = path.join(dir, "bakeshop.db");
    process.env.BAKESHOP_SEED = "0";
    process.env.BAKESHOP_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.BAKESHOP_S3_BUCKET = "lasacream";
    process.env.BAKESHOP_S3_REGION = "auto";
    process.env.BAKESHOP_S3_ACCESS_KEY_ID = "key";
    process.env.BAKESHOP_S3_SECRET_ACCESS_KEY = "secret";
    process.env.BAKESHOP_S3_OBJECT_KEY = "bakeshop.db";
    resetDatabaseForTests();

    createItem({ name: "Sesame", category: "ingredient", icon: "🌱", baseUnit: "g" });
    worker?.postMessage({ type: "failPuts", value: true });
    assert.throws(
      () => createItem({ name: "Honey", category: "ingredient", icon: "🍯", baseUnit: "g" }),
      (error: unknown) => error instanceof DomainError && /not saved/.test(error.message),
    );
    assert.equal(getItemByName("Honey"), undefined);
    assert.equal(getItemByName("Sesame")?.name, "Sesame");
  });

  it("does not start a new shop when the saved copy cannot be loaded", async () => {
    rememberEnv();
    const port = await startWorker();
    dir = mkdtempSync(path.join(tmpdir(), "bakeshop-"));
    process.env.BAKESHOP_DB = path.join(dir, "bakeshop.db");
    process.env.BAKESHOP_SEED = "0";
    process.env.BAKESHOP_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.BAKESHOP_S3_BUCKET = "lasacream";
    process.env.BAKESHOP_S3_REGION = "auto";
    process.env.BAKESHOP_S3_ACCESS_KEY_ID = "key";
    process.env.BAKESHOP_S3_SECRET_ACCESS_KEY = "secret";
    process.env.BAKESHOP_S3_OBJECT_KEY = "bakeshop.db";
    resetDatabaseForTests();
    worker?.postMessage({ type: "failGets", value: true });
    assert.throws(() => getDb(), DomainError);
    assert.equal(await storedCount(), 0);
  });
});

function getItemByName(name: string): { name: string } | undefined {
  return getDb().prepare("SELECT name FROM inventory_items WHERE name = ?").get(name) as { name: string } | undefined;
}
