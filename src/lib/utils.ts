import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the Navy Command type scale (globals.css @theme --text-*) as FONT SIZES.
// Unregistered, `text-body-sm` is mistaken for a text COLOUR and silently removes a real colour class
// such as `text-[color:var(--primary-foreground)]` — which made a small primary button's label
// navy-on-navy (found by the DEV-UI-01.1 screenshot comparison).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body-sm", "body", "body-lg", "title-sm", "title", "page", "display-sm", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
