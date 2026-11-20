import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The `?q=` search term from a page's search params, trimmed ("" when absent). */
export function searchTerm(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

/** Case-insensitive substring match of `term` against any of `fields`. */
export function matchesSearch(term: string, ...fields: (string | number | null | undefined)[]) {
  if (!term) return true
  const needle = term.toLowerCase()
  return fields.some((field) => field != null && String(field).toLowerCase().includes(needle))
}
