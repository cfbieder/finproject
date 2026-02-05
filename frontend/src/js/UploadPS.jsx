import { useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "./rest.js";
import "../pages/PageLayout.css";

export default function UploadPS() {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  const handleUpload = async () => {
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
      // Using v2 API (wraps v1)
      await Rest.fetchJson("/api/v2/ingest-ps/upload-ps", {
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
    } catch (error) {
      setUploadStatus({
        type: "error",
        message: error?.message ?? "Failed to upload the payroll file.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main upload-grid">
        <section className="upload-panel">
          <h1 className="page__title">Upload PS CSV Spreadsheet</h1>
          <p className="page__description">
            Drop a fresh payroll summary here and let the dashboard keep the
            rest of your financial signals in sync.
          </p>
          <ul className="upload-guidance">
            <li>Ensure the file uses the approved template.</li>
            <li>Include all staff totals for the selected period.</li>
            <li>Files remain private and are not stored permanently.</li>
          </ul>
        </section>
        <section className="upload-panel upload-form">
          <div className="upload-form-field">
            <label htmlFor="payrollFile">Payroll file</label>
            <input
              type="file"
              id="payrollFile"
              ref={fileInputRef}
              accept=".csv,text/csv"
            />
          </div>
          <button
            type="button"
            className="upload-submit"
            onClick={handleUpload}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Upload"}
          </button>
          <button type="button" className="upload-submit">
            Analyze
          </button>
          {uploadStatus?.message && (
            <p
              className={`upload-feedback upload-feedback_${
                uploadStatus.type ?? "info"
              }`}
            >
              {uploadStatus.message}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
