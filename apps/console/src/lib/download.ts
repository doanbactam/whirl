/** Saves a text file from the browser via a throwaway object URL. */
export function downloadTextFile(
  filename: string,
  text: string,
  mimeType = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
