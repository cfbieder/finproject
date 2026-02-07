import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "../contexts";
import "./PageLayout.css";
import "./BackupDatabase.css";

/**
 * BackupDatabase - Database backup page
 *
 * Provides functionality to backup the PostgreSQL database and download the backup file.
 */
export default function BackupDatabase() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  const [error, setError] = useState(null);

  const handleBackup = async () => {
    setIsBackingUp(true);
    setBackupStatus(null);
    setError(null);

    try {
      // Call the v2 backup API (PostgreSQL) - this will trigger a file download
      const response = await fetch("/api/v2/util/backup-database", {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create backup");
      }

      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "backup.tar.gz";
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Get the blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      window.URL.revokeObjectURL(url);

      // Get file size
      const sizeInMB = (blob.size / (1024 * 1024)).toFixed(2);

      setBackupStatus({
        message: "Backup created successfully!",
        backupName: filename.replace(".tar.gz", ""),
        size: `${sizeInMB} MB`,
        timestamp: new Date().toLocaleString(),
      });
      showSuccess("Backup created and downloaded successfully");
    } catch (err) {
      console.error("Backup failed:", err);
      setError(err.message || "Failed to create backup");
      showErrorToast(err.message || "Failed to create backup");
    } finally {
      setIsBackingUp(false);
    }
  };

  return (
    <>
      <main className="page-main backup-database-main">
        <div className="backup-database-container">
          <div className="backup-database-header">
            <h1 className="backup-database-title">Database Backup</h1>
            <p className="backup-database-subtitle">
              Create and download a backup of the PostgreSQL database
            </p>
          </div>

          <div className="backup-database-content">
            <div className="backup-database-card">
              <div className="backup-database-card-header">
                <h2 className="backup-database-card-title">Backup Database</h2>
                <p className="backup-database-card-description">
                  This will create a complete backup of all collections in the database.
                  The backup will be automatically downloaded to your computer.
                </p>
              </div>

              <div className="backup-database-card-body">
                {error && (
                  <div className="backup-database-alert backup-database-alert--error">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {backupStatus && (
                  <div className="backup-database-alert backup-database-alert--success">
                    <div className="backup-database-success-content">
                      <strong><Check size={16} strokeWidth={2.5} style={{ verticalAlign: "middle", marginRight: 4 }} /> {backupStatus.message}</strong>
                      <div className="backup-database-details">
                        <div className="backup-database-detail-item">
                          <span className="backup-database-detail-label">Backup Name:</span>
                          <span className="backup-database-detail-value">
                            {backupStatus.backupName}
                          </span>
                        </div>
                        {backupStatus.size && (
                          <div className="backup-database-detail-item">
                            <span className="backup-database-detail-label">Size:</span>
                            <span className="backup-database-detail-value">
                              {backupStatus.size}
                            </span>
                          </div>
                        )}
                        <div className="backup-database-detail-item">
                          <span className="backup-database-detail-label">Timestamp:</span>
                          <span className="backup-database-detail-value">
                            {backupStatus.timestamp}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="backup-database-button"
                  onClick={handleBackup}
                  disabled={isBackingUp}
                >
                  {isBackingUp ? (
                    <>
                      <span className="backup-database-spinner" />
                      Creating Backup...
                    </>
                  ) : (
                    "Create Backup"
                  )}
                </button>

                <div className="backup-database-info">
                  <h3 className="backup-database-info-title">What happens during backup?</h3>
                  <ol className="backup-database-info-list">
                    <li>PostgreSQL dump (pg_dump) is created</li>
                    <li>Backup is compressed and prepared for download</li>
                    <li>File download dialog opens automatically</li>
                    <li>Save the backup file to your preferred location</li>
                  </ol>
                </div>

                <div className="backup-database-warning">
                  <strong>Note:</strong> The backup process may take a few moments depending
                  on the size of your database. Please do not close this window until the
                  backup is complete.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
