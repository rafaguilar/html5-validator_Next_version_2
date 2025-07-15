import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Finds the most likely main HTML file from a list of file paths.
 * Prefers 'index.html' at the shallowest directory level.
 * Falls back to any '.html' file at the shallowest directory level.
 */
export function findHtmlFile(filePaths: string[]): string | undefined {
  const htmlFiles = filePaths
    .filter(path => path.toLowerCase().endsWith('.html') && !path.startsWith("__MACOSX/"));

  if (htmlFiles.length === 0) return undefined;
  if (htmlFiles.length === 1) return htmlFiles[0];

  const sortedByDepth = htmlFiles.sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    // If depth is the same, prefer 'index.html'
    if (a.toLowerCase().endsWith('index.html')) return -1;
    if (b.toLowerCase().endsWith('index.html')) return 1;
    return a.localeCompare(b);
  });

  return sortedByDepth[0];
}
