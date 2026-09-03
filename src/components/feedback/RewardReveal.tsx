"use client";

import { motion } from "framer-motion";
import { Gift } from "lucide-react";

export function RewardReveal({ label }: { label: string }) {
  return <motion.div className="inline-flex items-center gap-2 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-2 text-sm text-[var(--gold)]" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }}>
    <Gift className="h-4 w-4" />{label}
  </motion.div>;
}
