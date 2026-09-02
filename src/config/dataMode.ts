export type DataMode = "mock" | "api";

export const dataMode: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === "api" ? "api" : "mock";
