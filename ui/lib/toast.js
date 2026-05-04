import { toast } from "sonner";

export function toastError(error, fallback = "Something went wrong") {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : fallback;
  toast.error(message);
}

export { toast };
