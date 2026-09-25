import "server-only";
import { config } from "./config";

/** Supabase Storage REST helpers using the service role key. Ported from
 * backend/app/storage.py. */

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    apikey: config.supabaseServiceRoleKey,
    "Content-Type": "application/json",
  };
}

export interface SignedUpload {
  url: string;
  path: string;
}

export interface StorageObject {
  name: string;
  metadata?: { size?: number };
}

/** POST /storage/v1/object/upload/sign/{bucket}/{path} -> {url, token} */
export async function createSignedUploadUrl(
  bucket: string,
  path: string,
  expiresIn = 900,
): Promise<SignedUpload> {
  const resp = await fetch(
    `${config.supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${path}`,
    { method: "POST", headers: headers(), body: JSON.stringify({ expiresIn }) },
  );
  if (!resp.ok) throw new Error(`createSignedUploadUrl failed: ${resp.status}`);
  const data = await resp.json();
  const signedUrl = data.url ?? data.signedURL ?? data.signedUrl;
  return { url: `${config.supabaseUrl}/storage/v1${signedUrl}`, path };
}

/** POST /storage/v1/object/sign/{bucket}/{path} -> signed GET url */
export async function createSignedDownloadUrl(
  bucket: string,
  path: string,
  expiresIn = 3600,
): Promise<string> {
  const resp = await fetch(`${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ expiresIn }),
  });
  if (!resp.ok) throw new Error(`createSignedDownloadUrl failed: ${resp.status}`);
  const data = await resp.json();
  const signedUrl = data.signedURL ?? data.signedUrl;
  return `${config.supabaseUrl}/storage/v1${signedUrl}`;
}

/** POST /storage/v1/object/list/{bucket} -> objects directly under prefix. */
export async function listObjects(
  bucket: string,
  prefix: string,
  limit = 10000,
): Promise<StorageObject[]> {
  const resp = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ prefix, limit }),
  });
  if (!resp.ok) throw new Error(`listObjects failed: ${resp.status}`);
  return resp.json();
}

/** GET /storage/v1/object/{bucket}/{path} -> ArrayBuffer. */
export async function download(bucket: string, path: string): Promise<ArrayBuffer> {
  const resp = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    headers: headers(),
  });
  if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
  return resp.arrayBuffer();
}

/** POST /storage/v1/object/{bucket}/{path} with the file's bytes (upsert). */
export async function upload(
  bucket: string,
  path: string,
  data: Uint8Array | ArrayBuffer,
  contentType = "application/octet-stream",
): Promise<string> {
  const resp = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": contentType, "x-upsert": "true" },
    body: data as BodyInit,
  });
  if (!resp.ok) throw new Error(`upload failed: ${resp.status}`);
  return path;
}

export async function deleteObject(bucket: string, path: string): Promise<void> {
  await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: headers(),
  });
}

/** List and delete all objects under a prefix (used for account deletion). */
export async function deletePrefix(bucket: string, prefix: string): Promise<void> {
  const resp = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ prefix }),
  });
  if (resp.status !== 200) return;
  const objects: StorageObject[] = await resp.json();
  const paths = objects.map((o) => `${prefix}/${o.name}`);
  if (paths.length > 0) {
    await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify({ prefixes: paths }),
    });
  }
}
