const renderStatusItem = (status, includeDetails = false) => {
  if (!status?.message) {
    return null;
  }

  const detailList =
    includeDetails && Array.isArray(status.details) ? status.details : [];

  return (
    <li>
      <p
        className={`upload-feedback upload-feedback_${status.type ?? "info"}`}
      >
        {status.message}
      </p>
      {detailList.length > 0 && (
        <ul className="upload-feedback-details">
          {detailList.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </li>
  );
};

export default function UploadFeedback({
  lastIngestStatus,
  lastRefreshStatus,
  psDataCountStatus,
  uploadStatus,
  clearStatus,
  ingestStatus,
  analyzeStatus,
}) {
  return (
    <>
      {renderStatusItem(lastIngestStatus)}
      {renderStatusItem(lastRefreshStatus)}
      {renderStatusItem(psDataCountStatus)}
      {renderStatusItem(uploadStatus)}
      {renderStatusItem(clearStatus)}
      {renderStatusItem(ingestStatus)}
      {renderStatusItem(analyzeStatus, true)}
    </>
  );
}
