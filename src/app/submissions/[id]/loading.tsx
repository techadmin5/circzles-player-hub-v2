import { AppShell, LoadingSkeleton, PageFrame } from "@/components/ui";

export default function Loading() {
  return <AppShell><PageFrame title="Loading Submission"><LoadingSkeleton /></PageFrame></AppShell>;
}
