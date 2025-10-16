import fs from 'fs/promises';
import path from 'path';

let scriptContent: string | null = null;

// This function will be called on the server, so we can use fs
export const getGsapControllerScript = async (): Promise<string> => {
    // In a real app, you might cache this in memory in production
    // For development, reading it every time ensures we get the latest version.
    if (process.env.NODE_ENV === 'production' && scriptContent) {
        return scriptContent;
    }

    const scriptPath = path.join(process.cwd(), 'src', 'lib', 'injected-scripts', 'gsap-controller-injected.js');
    scriptContent = await fs.readFile(scriptPath, 'utf-8');
    return scriptContent;
};
