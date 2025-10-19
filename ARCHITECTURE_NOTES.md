# Architecture & Infrastructure Notes

This document captures key architectural decisions and infrastructure-related learnings for the HTML Validator application.

## Live Preview Feature: The Challenge of Serverless Environments

The implementation of the live preview feature for uploaded ZIP files has been a significant challenge. Several approaches were attempted, and the core issue was consistently traced back to a fundamental mismatch between the chosen architecture and the constraints of a standard serverless hosting environment (like Vercel or Netlify).

### The Core Problem: Filesystem Inconsistency in Serverless Functions

The most direct approach, and the one that ultimately caused the most issues on Netlify, was as follows:

1.  **Upload & Extract:** A serverless function (`/api/process-file`) receives the uploaded ZIP file. It generates a unique ID, creates a temporary directory on its local filesystem (e.g., `/tmp/<unique_id>`), and extracts all the creative's assets into it.
2.  **Serve Assets:** A separate serverless function (`/api/preview/[...slug]`) is responsible for serving the individual assets (HTML, JS, images) from the temporary directory to the user's `iframe` preview.

**This approach consistently failed on Netlify with `404 Not Found` errors.**

### The Reason for Failure

The failure is due to the stateless and ephemeral nature of serverless functions:

-   **Separate Execution Contexts:** On platforms like Netlify, the serverless function that handles the initial file upload and the function that serves the assets are **not guaranteed to be the same machine or have access to the same filesystem**.
-   **Ephemeral Filesystem:** The `/tmp` directory of a serverless function is not a persistent, shared disk. It exists only for the duration and context of that single function's execution. When the upload function finishes, its temporary directory is gone. When a new request comes in to fetch an asset, a new, completely separate function spins up with a clean filesystem, and it cannot find the files that were previously unzipped.

### Confirmation: Success on Firebase Hosting

As confirmed through parallel testing, this exact same server-side architecture **worked perfectly when deployed on Firebase infrastructure** (likely using Cloud Functions or Cloud Run). This indicates that Firebase's environment provides a more persistent or consistent execution context where the serving function *can* access the files written by the upload function, at least for a short period.

This critical difference highlights that the feature's success is highly dependent on the underlying infrastructure. The filesystem-based approach is inherently non-portable and not suitable for generic serverless platforms.
