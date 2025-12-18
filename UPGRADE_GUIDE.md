# Next.js Project Upgrade Guide (CVE-2025-55182)

This guide provides a consolidated set of steps to update a Next.js project to address the security vulnerability (CVE-2025-55182) and resolve the common dependency and build issues that arise from the update.

Follow these steps in order to ensure a smooth upgrade process.

---

### Step 1: Update Core Dependencies

The first step is to update `next`, `react`, and `react-dom` in your `package.json` to the specific versions required by the security advisory.

```json
{
  "dependencies": {
    "react": "19.0.0-rc-66855b96-20241106",
    "react-dom": "19.0.0-rc-66855b96-20241106",
    "next": "15.0.7"
  }
}
```

---

### Step 2: Add `overrides` for Peer Dependency Conflicts

Using a pre-release version of React often causes `ERESOLVE` errors during `npm install` because other libraries have peer dependency ranges that don't explicitly include the exact pre-release version string.

To fix this, add an `overrides` block to your `package.json`. This forces the conflicting packages to resolve their peer dependencies using the versions of `react` and `react-dom` already installed in your project.

Add this entire `overrides` block to your `package.json`:

```json
{
  "name": "your-project-name",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    ...
  },
  "dependencies": {
    ...
  },
  "devDependencies": {
    ...
  },
  "overrides": {
    "@tanstack/react-query": {
      "react": "$react"
    },
    "lucide-react": {
      "react": "$react"
    },
    "react-hook-form": {
      "react": "$react"
    },
    "recharts": {
      "react": "$react",
      "react-dom": "$react-dom"
    }
  }
}
```
*Note: The `"$react"` and `"$react-dom"` syntax is a feature of npm that tells it to reuse the version specified in your root `dependencies`.*

---

### Step 3: Correct `geist` Font Imports

A common build error after updating involves the `geist` font package. The exported font names are specific and do not contain underscores.

In your main layout file (e.g., `src/app/layout.tsx`), make sure your imports are corrected as follows:

**Incorrect:**
```typescript
import { Geist_Sans, Geist_Mono } from 'geist/font';
```

**Correct:**
```typescript
import { GeistSans, GeistMono } from 'geist/font';
```

Then, update the usage in your `<body>` tag's `className`:

```tsx
<body className={`${GeistSans.variable} ${GeistMono.variable} antialiased font-sans`}>
  {/* ... */}
</body>
```

---

### Step 4: Fix Genkit Initialization (if applicable)

If your project uses Genkit, you might encounter a build error related to `nextPlugin`. This indicates an incorrect initialization in your Genkit configuration. The `nextPlugin` is not required for a standard setup using the `googleAI` plugin.

Ensure your Genkit configuration file (e.g., `src/ai/genkit.ts`) is clean and only includes the necessary plugins.

**Incorrect:**
```typescript
import { genkit, nextPlugin } from '@genkit-ai/next';
import { googleAI } from '@genkit-ai/google-genai';

// This is wrong and will cause a build error
export const ai = genkit({
  plugins: [googleAI(), nextPlugin()], 
  // ...
});
```

**Correct:**
```typescript
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-1.5-flash',
});
```

---

After completing these steps, delete your `node_modules` directory and `package-lock.json` file, and then run `npm install` again. This should resolve all dependency and build errors.