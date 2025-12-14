import Rest from "./rest.js";

// Handles PS CSV uploads by reading the selected file and sending it to the server.
export default async function handleUpload(
  fileInputRef,
  setIsUploading,
  setUploadStatus
) {
  const file = fileInputRef.current?.files?.[0];
  if (!file) {
    setUploadStatus({
      type: "error",
      message: "Select a payroll file before uploading.",
    });
    return;
  }

  setIsUploading(true);
  setUploadStatus(null);
  try {
    const csvContent = await file.text();
    await Rest.fetchJson("/api/ingest-ps/upload-ps", {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
      },
      body: csvContent,
    });
    setUploadStatus({
      type: "success",
      message: "PS data copied to server successfully.",
    });
    return true;
  } catch (error) {
    setUploadStatus({
      type: "error",
      message: error?.message ?? "Failed to upload the payroll file.",
    });
    return false;
  } finally {
    setIsUploading(false);
  }
}
