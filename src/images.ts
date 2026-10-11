import SparkMD5 from "spark-md5";
import { config } from "./config";
import { ApiError, UserError } from "./api";
import { imageUrl } from "./protocol";
import type { Guest } from "./types";

const formats = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export function validateImage(file: File) {
  if (!formats.includes(file.type))
    throw new UserError("仅支持 JPG、PNG、WebP、GIF 图片");
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new UserError("图片大小需在 10MB 以内");
}
export async function prepareImage(file: File) {
  validateImage(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new UserError("无法读取图片，请重新选择");
    });
    const width = img.naturalWidth,
      height = img.naturalHeight;
    if (!width || !height || width * height > 40_000_000)
      throw new UserError("图片尺寸过大，请缩小后发送");
    const scale = Math.min(1, 400 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UserError("浏览器暂不支持图片处理");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new UserError("图片处理失败"))),
        "image/png",
      ),
    );
    return {
      width,
      height,
      thumbnail: new File([blob], "thumbnail.png", { type: "image/png" }),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Values = { key: string; values: string[] }[];
type Part = {
  partNumber: number;
  url?: string;
  query?: Values;
  header?: Values;
};
type Upload = {
  uploadID: string;
  partSize: number;
  sign: Part & { parts: Part[] };
};

// Same OpenIM object API and MD5-of-part-hashes contract as APP uploadFile.
// HTTP guest credentials keep uploads independent of management WebSocket availability.
export async function uploadImageFile(
  file: File,
  guest: Guest,
  signal: AbortSignal,
  progress: (value: number) => void,
  fetcher: typeof fetch = fetch,
) {
  const operationID = crypto.randomUUID();
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetcher(
      `${config.imApi.replace(/\/$/, "")}/object/${path}`,
      {
        method: "POST",
        headers: {
          token: guest.token,
          operationID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
    );
    const data = await response.json();
    if (!response.ok || data.errCode !== 0)
      throw new ApiError(response.status, "image_upload_failed");
    return data.data;
  };
  const { size: partSize } = await call<{ size: number }>("part_size", {
    size: file.size,
  });
  if (
    !Number.isInteger(partSize) ||
    partSize <= 0 ||
    Math.ceil(file.size / partSize) > 10000
  )
    throw new UserError("图片上传配置异常");
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += partSize) {
    signal.throwIfAborted();
    hashes.push(
      SparkMD5.ArrayBuffer.hash(
        await file.slice(offset, offset + partSize).arrayBuffer(),
      ),
    );
  }
  const extension =
    file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const name = `${guest.userId}/${operationID}.${extension}`;
  const started = await call<{ url?: string; upload?: Upload }>(
    "initiate_multipart_upload",
    {
      hash: SparkMD5.hash(hashes.join(",")),
      size: file.size,
      partSize,
      maxParts: -1,
      cause: "",
      name,
      contentType: file.type,
    },
  );
  if (started.url) {
    const url = imageUrl(started.url);
    if (!url) throw new UserError("图片上传返回了无效地址");
    progress(100);
    return url;
  }
  const upload = started.upload;
  if (
    !upload ||
    upload.partSize !== partSize ||
    upload.sign.parts.length !== hashes.length
  )
    throw new UserError("图片上传配置异常");
  const parts = [...upload.sign.parts].sort(
    (a, b) => a.partNumber - b.partNumber,
  );
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.partNumber !== i + 1) throw new UserError("图片上传分片异常");
    const target = imageUrl(part.url || upload.sign.url);
    if (!target) throw new UserError("图片上传地址异常");
    const url = new URL(target),
      headers = new Headers();
    for (const pair of [...(upload.sign.query || []), ...(part.query || [])]) {
      url.searchParams.delete(pair.key);
      for (const value of pair.values) url.searchParams.append(pair.key, value);
    }
    for (const pair of [...(upload.sign.header || []), ...(part.header || [])])
      headers.set(pair.key, pair.values.join(","));
    if (!headers.has("Content-Type")) headers.set("Content-Type", file.type);
    const response = await fetcher(url.href, {
      method: "PUT",
      headers,
      body: file.slice(i * partSize, (i + 1) * partSize),
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new UserError("图片上传失败，请重试");
    progress(Math.round(((i + 1) / parts.length) * 95));
  }
  const result = await call<{ url: string }>("complete_multipart_upload", {
    uploadID: upload.uploadID,
    parts: hashes,
    cause: "",
    name,
    contentType: file.type,
  });
  const url = imageUrl(result.url);
  if (!url) throw new UserError("图片上传返回了无效地址");
  progress(100);
  return url;
}
