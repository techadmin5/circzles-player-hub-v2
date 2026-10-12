export const MAX_VIDEO_SIZE_BYTES = 104857600;
export function validateVideoFile(file: Pick<File, "size" | "type">) {
  if (!["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"].includes(file.type)) throw new Error("Use an MP4, MOV, WebM or M4V video. Filename extensions alone are not accepted.");
  if (!file.size || file.size > MAX_VIDEO_SIZE_BYTES) throw new Error("Video must be no larger than 100 MB (100 MiB).");
}
export async function readVideoDuration(file: File): Promise<number> {
  validateVideoFile(file);
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"), url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Video duration could not be read. Select a playable recording.")); }, 10000);
    video.preload = "metadata";
    video.onloadedmetadata = () => { const duration = Math.ceil(video.duration * 1000); cleanup(); if (!Number.isSafeInteger(duration) || duration <= 0) reject(new Error("A recording with a valid duration is required.")); else resolve(duration); };
    video.onerror = () => { cleanup(); reject(new Error("This recording cannot be read. Try another supported format.")); };
    video.src = url;
  });
}

export function formatVideoDuration(time: number | null | undefined) {
  if (time == null) return "Unverified";
  const base = String(Math.floor(time / 60000)).padStart(2, "0") + ":" + String(Math.floor(time / 1000) % 60).padStart(2, "0");
  return time % 1000 ? base + "." + String(time % 1000).padStart(3, "0") : base;
}
