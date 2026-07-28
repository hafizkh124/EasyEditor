/**
 * Fast string hash for document plain text verification (FR-1.2).
 * Used to ensure incomplete task runs are only resumed if document text is unchanged.
 */
export function computeDocHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
