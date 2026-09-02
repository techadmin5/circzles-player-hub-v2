import { AppShell, LoadingSkeleton, PageFrame } from "@/components/ui";

export default function Loading() {
  return <AppShell><PageFrame title="Loading Profile"><LoadingSkeleton /></PageFrame></AppShell>;
}
