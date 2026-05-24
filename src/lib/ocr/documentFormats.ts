// OCR document format constants and detection utilities.

/** Accepted formats for the OCR file-input `accept` attribute. */
export const ACCEPTED_OCR = "image/*,.pdf,.tif,.tiff";

/** Maximum file size for images (10 MB). */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum file size for PDFs (50 MB). */
export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

/** Maximum number of pages to process per PDF. */
export const MAX_PDF_PAGES = 50;

export type DocumentType = "image" | "pdf" | "unsupported";

/** Detect the document type from a File's MIME type and extension. */
export function getDocumentType(file: File): DocumentType {
  // Check MIME type first
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";

  // Fallback to extension
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "svg"].includes(ext)) return "image";

  return "unsupported";
}

/** Returns the max allowed file size for the given document type. */
export function getMaxFileSize(docType: DocumentType): number {
  return docType === "pdf" ? MAX_PDF_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
}
