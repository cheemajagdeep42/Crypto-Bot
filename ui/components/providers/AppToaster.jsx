"use client";

import { Toaster } from "sonner";

/** Mount once in root layout; uses CSS variables from globals for contrast. */
export function AppToaster() {
  return (
    <Toaster
      richColors
      closeButton
      position="top-right"
      toastOptions={{
        classNames: {
          error: "border-[#e50914]/40"
        }
      }}
    />
  );
}
