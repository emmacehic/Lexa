"use client";

import * as tus from "tus-js-client";

/**
 * Progress-reporting upload.
 *
 * - Supabase / hybrid (small files): signed PUT straight to Storage.
 * - Local / hybrid (large files): direct POST or tus through this server.
 * - Hybrid: if Supabase signing or upload fails, retries on local disk.
 */

export interface UploadHandle {
  abort: () => void;
}

export interface StartUploadOptions {
  file: File;
  recordingId: string;
  storageKey: string;
  onProgress: (bytesSent: number, bytesTotal: number) => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}

type SignResponse = {
  mode?: "tus" | "signed-put" | "direct";
  signedUrl?: string;
  fallback?: boolean;
};

function readApiError(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    if (body) return body.slice(0, 400);
  }
  return fallback;
}

async function requestUploadSign(
  options: StartUploadOptions,
  signal: AbortSignal,
  forceLocal: boolean,
): Promise<SignResponse | null> {
  const signResponse = await fetch("/api/uploads/sign", {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      "content-type": "application/json",
      "x-lexa-recording": options.recordingId,
      "x-lexa-object": options.storageKey,
    },
    body: JSON.stringify({ byteSize: options.file.size, forceLocal }),
  });

  if (!signResponse.ok) {
    const body = await signResponse.text();
    throw new Error(
      readApiError(
        body,
        `Could not start the upload (HTTP ${signResponse.status}).`,
      ),
    );
  }

  return (await signResponse.json()) as SignResponse;
}

function startTusUpload(
  options: StartUploadOptions,
  abortController: AbortController,
): UploadHandle {
  let upload: tus.Upload | null = null;

  upload = new tus.Upload(options.file, {
    endpoint: "/api/uploads/tus",
    chunkSize: 32 * 1024 * 1024,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    storeFingerprintForResuming: false,
    onBeforeRequest: (req) => {
      const xhr = req.getUnderlyingObject() as XMLHttpRequest | undefined;
      if (xhr) xhr.withCredentials = true;
    },
    metadata: {
      objectName: options.storageKey,
      contentType: options.file.type || "application/octet-stream",
    },
    headers: {
      "x-lexa-recording": options.recordingId,
    },
    onError: (error) => options.onError(error.message),
    onProgress: (bytesUploaded, bytesTotal) =>
      options.onProgress(bytesUploaded, bytesTotal),
    onSuccess: () => {
      options.onProgress(options.file.size, options.file.size);
      options.onSuccess();
    },
  });

  upload.start();
  abortController.signal.addEventListener("abort", () => upload?.abort(true), {
    once: true,
  });

  return {
    abort: () => {
      abortController.abort();
      upload?.abort(true);
    },
  };
}

function startDirectPostUpload(
  options: StartUploadOptions,
  abortController: AbortController,
): UploadHandle {
  let uploadXhr: XMLHttpRequest | null = null;

  uploadXhr = new XMLHttpRequest();
  uploadXhr.open("POST", "/api/uploads/direct");
  uploadXhr.withCredentials = true;
  uploadXhr.setRequestHeader(
    "content-type",
    options.file.type || "application/octet-stream",
  );
  uploadXhr.setRequestHeader("x-lexa-recording", options.recordingId);
  uploadXhr.setRequestHeader("x-lexa-object", options.storageKey);

  uploadXhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      options.onProgress(event.loaded, event.total);
    }
  };

  uploadXhr.onload = () => {
    if (uploadXhr && uploadXhr.status >= 200 && uploadXhr.status < 300) {
      options.onProgress(options.file.size, options.file.size);
      options.onSuccess();
      return;
    }
    const status = uploadXhr?.status ?? 0;
    const body = uploadXhr?.responseText ?? "";
    options.onError(
      readApiError(body, `Upload failed (HTTP ${status}).`),
    );
  };

  uploadXhr.onerror = () =>
    options.onError(
      "The upload could not reach the server. Check your connection and try again.",
    );
  uploadXhr.onabort = () => options.onError("The upload was cancelled.");

  if (abortController.signal.aborted) {
    uploadXhr.abort();
  } else {
    abortController.signal.addEventListener("abort", () => uploadXhr?.abort(), {
      once: true,
    });
    uploadXhr.send(options.file);
  }

  return {
    abort: () => {
      abortController.abort();
      uploadXhr?.abort();
    },
  };
}

function startSignedPutUpload(
  options: StartUploadOptions,
  signedUrl: string,
  abortController: AbortController,
  onSupabaseFailed: () => void,
): UploadHandle {
  let uploadXhr: XMLHttpRequest | null = null;
  let fellBack = false;

  uploadXhr = new XMLHttpRequest();
  uploadXhr.open("PUT", signedUrl);
  uploadXhr.setRequestHeader(
    "content-type",
    options.file.type || "application/octet-stream",
  );

  uploadXhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      options.onProgress(event.loaded, event.total);
    }
  };

  const triggerFallback = () => {
    if (fellBack || abortController.signal.aborted) return;
    fellBack = true;
    uploadXhr?.abort();
    options.onProgress(0, options.file.size);
    onSupabaseFailed();
  };

  uploadXhr.onload = () => {
    if (uploadXhr && uploadXhr.status >= 200 && uploadXhr.status < 300) {
      options.onProgress(options.file.size, options.file.size);
      options.onSuccess();
      return;
    }
    triggerFallback();
  };

  uploadXhr.onerror = () => triggerFallback();
  uploadXhr.onabort = () => {
    if (!fellBack && !abortController.signal.aborted) {
      options.onError("The upload was cancelled.");
    }
  };

  if (abortController.signal.aborted) {
    uploadXhr.abort();
  } else {
    abortController.signal.addEventListener("abort", () => uploadXhr?.abort(), {
      once: true,
    });
    uploadXhr.send(options.file);
  }

  return {
    abort: () => {
      abortController.abort();
      uploadXhr?.abort();
    },
  };
}

function runUploadFromSign(
  options: StartUploadOptions,
  signBody: SignResponse,
  abortController: AbortController,
  retryLocal: () => void,
): UploadHandle {
  if (signBody.mode === "direct") {
    return startDirectPostUpload(options, abortController);
  }

  if (signBody.mode === "tus") {
    return startTusUpload(options, abortController);
  }

  if (!signBody.signedUrl) {
    options.onError("The server did not return an upload URL.");
    return { abort: () => abortController.abort() };
  }

  return startSignedPutUpload(
    options,
    signBody.signedUrl,
    abortController,
    retryLocal,
  );
}

export function startUpload(options: StartUploadOptions): UploadHandle {
  const abortController = new AbortController();
  let activeHandle: UploadHandle | null = null;

  const begin = async (forceLocal: boolean) => {
    const signBody = await requestUploadSign(
      options,
      abortController.signal,
      forceLocal,
    );
    if (!signBody || abortController.signal.aborted) return;

    activeHandle = runUploadFromSign(options, signBody, abortController, () => {
      void begin(true);
    });
  };

  void begin(false).catch((error) => {
    if (abortController.signal.aborted) return;
    options.onError(
      error instanceof Error
        ? error.message
        : "The upload could not be started.",
    );
  });

  return {
    abort: () => {
      abortController.abort();
      activeHandle?.abort();
    },
  };
}

/** Best-effort duration probe so the row shows a length before the worker runs. */
export function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement("video");
    media.preload = "metadata";
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : 0);
    };
    media.onloadedmetadata = () => done(media.duration);
    media.onerror = () => done(0);
    media.src = url;
    setTimeout(() => done(media.duration || 0), 4000);
  });
}
