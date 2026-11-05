/** Append a decoded SSE chunk and normalize CRLF over the WHOLE buffer.
 * Normalizing each chunk alone misses a CR/LF pair split across reads. */
export function appendSseChunk(buffer: string, chunk: string): string {
  return (buffer + chunk).replace(/\r\n/g, "\n");
}
