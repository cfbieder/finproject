import ConfirmationDialog from "./ConfirmationDialog.jsx";

export default function UploadForm({
  fileInputRef,
  setHasFileSelected,
  hasFileSelected,
  handleClearClick,
  isUploading,
  isClearing,
  isClearConfirmOpen,
  handleClearConfirm,
  handleClearCancel,
  handleUploadClick,
  handleAnalyzeClick,
  isAnalyzing,
}) {
  return (
    <section className="upload-panel upload-form">
      <div className="upload-form-field">
        <label htmlFor="psFile">PS file</label>
        <input
          type="file"
          id="psFile"
          ref={fileInputRef}
          accept=".csv,text/csv"
          onChange={(event) =>
            setHasFileSelected((event.target.files?.length ?? 0) > 0)
          }
        />
      </div>
      <div className="upload-actions">
        <button
          type="button"
          className="upload-submit"
          onClick={handleClearClick}
          disabled={isUploading || isClearing}
        >
          {isClearing ? "Clearing..." : "Clear PS records"}
        </button>
        {isClearConfirmOpen && !isClearing && (
          <ConfirmationDialog
            message="This will permanently delete all imported PS records. Confirming will wipe every record from MongoDB."
            onConfirm={handleClearConfirm}
            onCancel={handleClearCancel}
            confirmLabel="Confirm clear"
            cancelLabel="Cancel"
          />
        )}
        <button
          type="button"
          className="upload-submit"
          onClick={handleUploadClick}
          disabled={isUploading || isClearing || !hasFileSelected}
        >
          {isUploading ? "Uploading..." : "Upload"}
        </button>
        <button
          type="button"
          className="upload-submit"
          onClick={handleAnalyzeClick}
          disabled={isUploading || isClearing || isAnalyzing}
        >
          {isAnalyzing ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </section>
  );
}
