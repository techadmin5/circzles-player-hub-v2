import { proxyApiRequest } from "@/lib/server/apiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Explicit OPTIONS/HEAD exports prevent Next from synthesizing local responses.
export const GET = proxyApiRequest;
export const HEAD = proxyApiRequest;
export const POST = proxyApiRequest;
export const PUT = proxyApiRequest;
export const PATCH = proxyApiRequest;
export const DELETE = proxyApiRequest;
export const OPTIONS = proxyApiRequest;
