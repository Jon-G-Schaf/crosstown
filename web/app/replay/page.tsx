import type { Metadata } from "next";
import { ReplayMap } from "@/components/replay-map";

export const metadata: Metadata = {
  title: "Replay - Crosstown",
  description: "Replay the last day of Columbus bus movement across the city.",
};

export default function ReplayPage() {
  return <ReplayMap />;
}
