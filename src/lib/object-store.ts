import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { getUploadsPath } from "@/lib/db";

export type StoredUpload = {
  body: Buffer;
  contentType: string;
};

function r2Config() {
  const bucket = process.env.R2_BUCKET?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim().replace(/\/+$/, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const prefix = process.env.R2_UPLOADS_PREFIX?.trim().replace(/^\/+|\/+$/g, "");
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey || !prefix) {
    return null;
  }
  return { bucket, endpoint, accessKeyId, secretAccessKey, prefix };
}

export function usesR2Uploads(): boolean {
  return r2Config() !== null;
}

function objectKey(prefix: string, filename: string): string {
  return `${prefix}/${filename}`;
}

const CHECKSUM_HEADER =
  /^(x-amz-checksum-|x-amz-sdk-checksum-|x-amz-trailer|x-amz-checksum-mode)/i;

let cachedClient: S3Client | null = null;

function s3Client(endpoint: string, accessKeyId: string, secretAccessKey: string): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    cachedClient.middlewareStack.add(
      (next) => async (args) => {
        const req = args.request as { headers?: Record<string, string> } | undefined;
        const headers = req?.headers;
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (CHECKSUM_HEADER.test(key)) {
              delete headers[key];
            }
          }
        }
        return next(args);
      },
      { step: "build", name: "stripR2IncompatibleChecksumHeaders", priority: "low" },
    );
  }
  return cachedClient;
}

async function putLocal(filename: string, body: Buffer): Promise<void> {
  const dest = path.join(getUploadsPath(), filename);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, body);
}

async function getLocal(filename: string): Promise<Buffer | null> {
  const filePath = path.join(getUploadsPath(), filename);
  try {
    return await fs.promises.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function putUpload(
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const cfg = r2Config();
  if (!cfg) {
    await putLocal(filename, body);
    return;
  }
  const client = s3Client(cfg.endpoint, cfg.accessKeyId, cfg.secretAccessKey);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey(cfg.prefix, filename),
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
  );
}

export async function getUpload(
  filename: string,
  contentType: string,
): Promise<StoredUpload | null> {
  const cfg = r2Config();
  if (cfg) {
    try {
      const client = s3Client(cfg.endpoint, cfg.accessKeyId, cfg.secretAccessKey);
      const out = await client.send(
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey(cfg.prefix, filename),
        }),
      );
      if (!out.Body) return null;
      const bytes = await out.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: out.ContentType || contentType,
      };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== "NoSuchKey" && name !== "NotFound") {
        const local = await getLocal(filename);
        if (local) return { body: local, contentType };
        throw err;
      }
    }
    const local = await getLocal(filename);
    if (local) return { body: local, contentType };
    return null;
  }

  const local = await getLocal(filename);
  if (!local) return null;
  return { body: local, contentType };
}

export function formatUploadError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : "Upload failed";
  }
  const e = err as {
    name?: string;
    message?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = e.Code || e.code || e.name;
  const status = e.$metadata?.httpStatusCode;
  const parts = [
    code && code !== "Error" ? code : null,
    status ? `HTTP ${status}` : null,
    e.message,
  ].filter(Boolean);
  return parts.join(": ") || "Upload failed";
}
