'use server';

import { db } from '@/lib/firebase';
import { collection, addDoc, getDoc, doc } from 'firebase/firestore';
import type { ValidationResult } from '@/types';


// We need a version of ValidationResult that is serializable for Firestore.
type SerializableValidationResult = Omit<ValidationResult, 'preview'> & {
    preview: {
        id: string;
        fileName: string;
        entryPoint: string;
        processedHtml: string | null;
        securityWarning: string | null;
    } | null;
};


/**
 * Saves a validation report to Firestore.
 * @param reportData The array of validation results.
 * @returns The unique ID of the saved report document.
 */
export async function saveReport(reportData: ValidationResult[]): Promise<string> {
  try {
    // Sanitize the data to ensure it's serializable
    const serializableReportData: SerializableValidationResult[] = reportData.map(result => {
        const { preview, ...rest } = result;
        const serializablePreview = preview ? {
            id: preview.id,
            fileName: preview.fileName,
            entryPoint: preview.entryPoint,
            processedHtml: preview.processedHtml || null, // Already a string
            securityWarning: preview.securityWarning || null,
        } : null;
        
        return {
            ...rest,
            preview: serializablePreview,
        };
    });

    const docRef = await addDoc(collection(db, 'reports'), {
      createdAt: new Date(),
      results: serializableReportData,
    });
    return docRef.id;
  } catch (error) {
    console.error("[TRACE] Full error saving report to Firestore:", error);
    if (error instanceof Error) {
        throw new Error(`Could not save the report: ${error.message}`);
    }
    throw new Error("Could not save the report due to an unknown error.");
  }
}

/**
 * Retrieves a validation report from Firestore.
 * @param id The unique ID of the report document.
 * @returns The validation report data.
 */
export async function getReport(id: string): Promise<ValidationResult[] | null> {
    try {
        const docRef = doc(db, 'reports', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // Firestore timestamps need to be converted
            const report = {
                ...data,
                createdAt: data.createdAt.toDate(),
            };
            // The data from firestore is serializable, we need to cast it back to the full type
            const results = report.results as SerializableValidationResult[];
            return results as ValidationResult[];

        } else {
            console.log("No such document!");
            return null;
        }
    } catch (error) {
        console.error("Error fetching report from Firestore:", error);
        return null;
    }
}
