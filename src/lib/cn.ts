import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Helper de composição de classes (convenção shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
