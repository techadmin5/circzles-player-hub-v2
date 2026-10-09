import { AppShell, LoadingSkeleton, PageFrame } from "@/components/ui";

export default function Loading() {
  return <AppShell><PageFrame title="Loading CircZles"><LoadingSkeleton /></PageFrame></AppShell>;
}
