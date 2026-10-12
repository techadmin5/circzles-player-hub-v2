import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
process.env.NEXT_PUBLIC_DATA_MODE = "api";
process.env.NEXT_PUBLIC_API_BASE_URL = "https://hub.example.test";
const { SubmissionStepper, parseCompletionTime } = await import("./SubmissionStepper.tsx");
const { SubmissionListClient } = await import("./SubmissionListClient.tsx");
const { SubmissionReviewAdmin } = await import("../admin/SubmissionReviewAdmin.tsx");
const { validateVideoFile, MAX_VIDEO_SIZE_BYTES } = await import("../../lib/submissionVideo.ts");
const { useSound } = await import("../../hooks/useSound.ts");
const puzzle = { id: "puzzle", playerPuzzleId: "owned", name: "Lion", levelId: 1, maxLeaderboardTimeMs: 300000 };
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hub.example.test/submissions/new?puzzleId=puzzle" });
  const saved = ["window", "self", "document", "HTMLElement", "Element", "SVGElement", "FormData", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key] of saved) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key] });
  useSound.setState({ master: false });
  let duration = 300;
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, "duration", { get: () => duration });
  dom.window.HTMLMediaElement.prototype.load = () => {};
  const descriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLMediaElement.prototype, "src");
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, "src", { get: descriptor.get, set(value) { descriptor.set.call(this, value); queueMicrotask(() => this.onloadedmetadata?.()); } });
  const urls = ["createObjectURL", "revokeObjectURL"].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)]);
  URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {};
  const transfers = [];
  class XHR {
    upload = {}; status = 200; headers = {};
    open(method, url) { this.url = url; } setRequestHeader(name, value) { this.headers[name] = value; }
    send(form) { transfers.push({ url: this.url, form, headers: this.headers }); queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 }); this.onload(); }); }
  }
  const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest"); Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: XHR });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, desc] of saved) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; } for (const [key, desc] of urls) { if (desc) Object.defineProperty(URL, key, desc); else delete URL[key]; } if (xhrDescriptor) Object.defineProperty(globalThis, "XMLHttpRequest", xhrDescriptor); else delete globalThis.XMLHttpRequest; });
  return { root, transfers, setDuration: value => { duration = value; } };
}
async function click(text) { const button = [...document.querySelectorAll("button")].find(b => b.textContent.endsWith(text)); assert.ok(button, text); await act(async () => button.click()); }
async function change(node, value) { await act(async () => { node.value = value; node[Object.keys(node).find(key => key.startsWith("__reactProps"))].onChange({ target: node }); }); }
async function selectFile(file) { const input = document.querySelector('input[type="file"]'); await act(async () => { Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new window.Event("change", { bubbles: true })); await new Promise(setImmediate); }); }
async function prepareVideo() { await click("Enter Time"); await change(document.querySelector('[aria-label="Completion time"]'), "05:00"); await click("Select Video"); await selectFile(new window.File(["recording"], "lion.mp4", { type: "video/mp4" })); }
test("video preflight accepts exactly 100 MB and rejects size/type spoofing; time parsing preserves milliseconds", () => {
  assert.equal(MAX_VIDEO_SIZE_BYTES, 100000000);
  validateVideoFile({ size: 100000000, type: "video/mp4" });
  assert.throws(() => validateVideoFile({ size: 100000001, type: "video/mp4" }));
  assert.throws(() => validateVideoFile({ size: 1, type: "text/plain", name: "video.mp4" }));
  assert.equal(parseCompletionTime("05:00"), 300000); assert.equal(parseCompletionTime("05:00.001"), 300001);
});
test("direct protected upload retries finalization without transfer, preserves submission key after lost response, and shows success only after database confirmation", async t => {
  const { root, transfers } = await setup(t); let finalize = 0, submitted = 0; const keys = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("signed-url")) return Response.json({ videoUploadId: "video", uploadUrl: "https://api.cloudinary.com/v1_1/test/video/upload", expiresAt: new Date(Date.now() + 600000).toISOString(), fields: { apiKey: "public", timestamp: 1, publicId: "bound", signature: "signature", type: "authenticated", overwrite: "false", allowedFormats: "mp4,mov,webm,m4v" } });
    if (path.endsWith("/complete")) { finalize++; return finalize === 1 ? Response.json({ message: "Verification temporarily unavailable" }, { status: 503 }) : Response.json({ status: "COMPLETE", durationMs: 300000 }); }
    if (path === "/api/submissions") { submitted++; keys.push(init.headers["Idempotency-Key"]); if (submitted === 1) throw new Error("Browser lost response"); return Response.json({ id: "submission", status: "PENDING_REVIEW" }); }
    if (path === "/api/me") return Response.json({ internalId: "player", publicPlayerId: "CZ-1", displayName: "Player" });
    return Response.json([]);
  });
  await act(async () => root.render(createElement(SubmissionStepper, { puzzles: [puzzle] })));
  assert.match(document.body.textContent, /Maximum eligible duration: 05:00/); await prepareVideo(); assert.match(document.body.textContent, /Actual recording duration: 05:00/);
  await click("Upload"); await click("Continue"); assert.match(document.querySelector('[role="alert"]').textContent, /Verification/); assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(transfers.length, 1); assert.equal(transfers[0].form.get("type"), "authenticated"); assert.equal(transfers[0].headers["Content-Range"], "bytes 0-8/9");
  await click("Continue"); assert.equal(transfers.length, 1); assert.equal(finalize, 2); assert.equal(document.querySelector('[role="dialog"]'), null);
  await click("Submit"); await click("Submit Attempt"); assert.equal(document.querySelector('[role="dialog"]'), null); assert.match(document.querySelector('[role="alert"]').textContent, /lost response/);
  await click("Submit Attempt"); assert.equal(keys[0], keys[1]); assert.match(document.querySelector('[role="dialog"]').textContent, /Submission Received!/); assert.match(document.body.textContent, /aims to review it within 24 hours/); assert.match(document.body.textContent, /Back to My CircZles/);
});
test("over-limit recording and missing timing are blocked before transfer", async t => {
  const { root, transfers, setDuration } = await setup(t); setDuration(301);
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  await act(async () => root.render(createElement(SubmissionStepper, { puzzles: [puzzle] }))); await prepareVideo(); await click("Upload"); await click("Continue"); assert.match(document.querySelector('[role="alert"]').textContent, /exceeds/); assert.equal(transfers.length, 0);
  await act(async () => root.render(createElement(SubmissionStepper, { key: "missing", puzzles: [{ ...puzzle, maxLeaderboardTimeMs: null }] }))); await click("Continue"); assert.match(document.querySelector('[role="alert"]').textContent, /not been configured/);
});
test("submission history shows status, review note and date, and can retry failed loading", async t => {
  const { root } = await setup(t); let reads = 0;
  t.mock.method(globalThis, "fetch", async () => { reads++; return reads === 1 ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json([{ id: "attempt", puzzleId: "puzzle", puzzleName: "Lion", levelId: 1, completionTime: "05:00", status: "RESUBMISSION_REQUIRED", createdAt: "2026-10-12T00:00:00Z", reviewNote: "Record continuously" }]); });
  await act(async () => root.render(createElement(SubmissionListClient, { initial: [] }))); assert.match(document.querySelector('[role="alert"]').textContent, /could not be loaded/); await click("Refresh Submissions"); assert.match(document.body.textContent, /Resubmission Required/); assert.match(document.body.textContent, /Record continuously/);
});
test("review UI loads verified metadata, obtains protected video and records authorized decision/history", async t => {
  const { root } = await setup(t); const row = { submissionId: "attempt", status: "PENDING_REVIEW", puzzleName: "Lion", levelId: 1, completionTimeMs: 300000, maxLeaderboardTimeMs: 300000, submittedAt: "2026-10-12T00:00:00Z", player: { displayName: "Player", publicPlayerId: "CZ-1" }, video: { durationMs: 300000, verifiedSizeBytes: 100000000 }, reviewHistory: [] }; let reviewed = false; const decisions = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (new URL(url).pathname.endsWith("/review")) { decisions.push(JSON.parse(init.body)); assert.ok(init.headers["Idempotency-Key"]); reviewed = true; return Response.json({ decision: "APPROVED" }); }
    if (new URL(url).pathname.endsWith("/video")) return Response.json({ url: "https://api.cloudinary.com/protected-short-lived" });
    if (new URL(url).pathname.endsWith("attempt")) return Response.json({ ...row, status: reviewed ? "APPROVED" : "PENDING_REVIEW", reviewHistory: reviewed ? [{ decision: "APPROVED", reviewerAdminUserId: "reviewer", createdAt: "2026-10-12T01:00:00Z", reviewNote: "Valid evidence" }] : [] });
    return Response.json([row]);
  });
  await act(async () => root.render(createElement(SubmissionReviewAdmin))); await click("Review attempt"); assert.match(document.body.textContent, /Verified recording 05:00/); assert.match(document.body.textContent, /100.00 MB/); await click("Open protected video (5 minutes)"); assert.equal(document.querySelector("video").getAttribute("src"), "https://api.cloudinary.com/protected-short-lived"); await change(document.querySelector("textarea"), "Valid evidence"); await click("Approve"); assert.deepEqual(decisions[0], { decision: "APPROVED", reviewNote: "Valid evidence" }); assert.match(document.body.textContent, /Review recorded successfully/); assert.match(document.body.textContent, /Reviewer reviewer/);
});


test("100 MB uses direct chunks with progress and expiration prevents transfer", async t => {
  const { transfers } = await setup(t);
  const { uploadVideoDirectly } = await import("../../lib/apiClient.ts");
  const signed = { uploadUrl: "https://api.cloudinary.com/v1_1/test/video/upload", expiresAt: new Date(Date.now() + 600000).toISOString(), fields: { apiKey: "public", timestamp: 1, publicId: "bound", signature: "signature", type: "authenticated", overwrite: "false" } };
  const file = new window.File([new Uint8Array(MAX_VIDEO_SIZE_BYTES)], "large.mp4", { type: "video/mp4" });
  const progress = []; await uploadVideoDirectly(signed, file, value => progress.push(value));
  assert.equal(transfers.length, 16); assert.equal(progress.at(-1), 100); assert.ok(progress.some(value => value > 0 && value < 100));
  assert.equal(transfers.at(-1).headers["Content-Range"], "bytes 94371840-99999999/100000000");
  assert.equal(new Set(transfers.map(chunk => chunk.headers["X-Unique-Upload-Id"])).size, 1);
  await assert.rejects(uploadVideoDirectly({ ...signed, expiresAt: new Date(0).toISOString() }, file, () => {}), /expired/);
  assert.equal(transfers.length, 16);
  await assert.rejects(uploadVideoDirectly(signed, { size: 100000001, type: "video/mp4" }, () => {}), /100 MB/);
  assert.equal(transfers.length, 16);
});
test("selecting invalid video surfaces preflight error without requesting upload authorization", async t => {
  const { root } = await setup(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json([]); });
  await act(async () => root.render(createElement(SubmissionStepper, { puzzles: [puzzle] }))); await click("Select Video");
  await selectFile(new window.File(["not video"], "pretend.mp4", { type: "text/plain" }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Filename extensions/); assert.equal(calls, 0);
});
