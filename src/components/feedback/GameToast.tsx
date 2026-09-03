"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

export function GameToast({ message, open }: { message: string; open: boolean }) {
  return <AnimatePresence>
    {open && <motion.div className="fixed right-4 top-4 z-[90] rounded-lg border border-emerald-300/40 bg-[#07120d] px-4 py-3 text-sm text-emerald-100 shadow-2xl" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{message}</span>
    </motion.div>}
  </AnimatePresence>;
}
