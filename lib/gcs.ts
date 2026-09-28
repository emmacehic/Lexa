import { Storage } from "@google-cloud/storage";

import { requireEnv, SetupError } from "./env";

/**
 * Google Cloud Storage — used only to stage the normalized audio for
 * Speech-to-Text and to receive the batch transcript. Nothing lives here for
 * longer than one job.
 */

let storage: Storage | null = null;

export interface GcpCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export function serviceAccount(): GcpCredentials {
  const { GCP_SERVICE_ACCOUNT_JSON } = requireEnv("GCP_SERVICE_ACCOUNT_JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(GCP_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new SetupError(
      ["GCP_SERVICE_ACCOUNT_JSON"],
      "The value is not valid JSON. Paste the whole service-account key file on one line.",
    );
  }
  const creds = parsed as Partial<GcpCredentials>;
  if (!creds.client_email || !creds.private_key) {
    throw new SetupError(
      ["GCP_SERVICE_ACCOUNT_JSON"],
      "The JSON is missing client_email or private_key — that is not a service-account key.",
    );
  }
  return {
    client_email: creds.client_email,
    private_key: creds.private_key.replace(/\\n/g, "\n"),
    project_id: creds.project_id,
  };
}

export function gcs(): { storage: Storage; bucket: string } {
  const { GCP_PROJECT_ID, GCS_STAGING_BUCKET } = requireEnv(
    "GCP_PROJECT_ID",
    "GCS_STAGING_BUCKET",
  );
  if (!storage) {
    const credentials = serviceAccount();
    storage = new Storage({ projectId: GCP_PROJECT_ID, credentials });
  }
  return { storage, bucket: GCS_STAGING_BUCKET };
}

export async function uploadStagingFile(
  localPath: string,
  objectName: string,
): Promise<string> {
  const { storage: client, bucket } = gcs();
  await client.bucket(bucket).upload(localPath, {
    destination: objectName,
    resumable: true,
    contentType: "audio/flac",
  });
  return `gs://${bucket}/${objectName}`;
}

export async function readGcsJson(uri: string): Promise<unknown> {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Not a Cloud Storage URI: ${uri}`);
  const { storage: client } = gcs();
  const [contents] = await client.bucket(match[1]).file(match[2]).download();
  return JSON.parse(contents.toString("utf8"));
}

export async function deleteStagingPrefix(prefix: string): Promise<void> {
  const { storage: client, bucket } = gcs();
  await client.bucket(bucket).deleteFiles({ prefix, force: true });
}
