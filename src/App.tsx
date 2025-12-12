import { useState, useEffect } from 'react';
import './App.css';
import { listFiles, type S3File } from './s3Client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface JobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  filesCompleted: number;
  totalFiles: number;
  downloadUrl?: string;
  error?: string;
}

function App() {
  const [files, setFiles] = useState<S3File[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [currentJob, setCurrentJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const fileList = await listFiles();
      setFiles(fileList);
    } catch (error) {
      console.error('Error fetching files:', error);
      setError('Failed to connect to storage. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const toggleFileSelection = (key: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedFiles(newSelected);
  };

  const selectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.key)));
    }
  };

  const initiateDownload = async (fileKeys: string[]) => {
    try {
      setError(null);
      setCurrentJob(null);

      // Call initiate endpoint
      const response = await fetch(`${API_URL}/v1/download/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_keys: fileKeys }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to initiate download');
      }

      const data = await response.json();
      
      // Show "Processing your download..." message
      setCurrentJob({
        jobId: data.jobId,
        status: data.status,
        progress: 0,
        filesCompleted: 0,
        totalFiles: data.totalFiles,
      });

      // Subscribe to SSE for progress updates
      subscribeToProgress(data.jobId, data.subscribeUrl);
      
      // Clear selection
      setSelectedFiles(new Set());
    } catch (error) {
      console.error('Error initiating download:', error);
      setError(error instanceof Error ? error.message : 'Failed to initiate download');
    }
  };

  const subscribeToProgress = (jobId: string, subscribeUrl: string) => {
    const eventSource = new EventSource(`${API_URL}${subscribeUrl}`);

    eventSource.addEventListener('progress', (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      const updatedJob = {
        jobId: data.jobId,
        status: data.status,
        progress: data.progress,
        filesCompleted: data.filesCompleted,
        totalFiles: data.totalFiles,
        downloadUrl: data.downloadUrl, // May be undefined during progress
      };
      setCurrentJob(updatedJob);
      
      // Also check if status changed to completed via progress event (fallback)
      if (data.status === 'completed' && data.downloadUrl) {
        setTimeout(() => {
          window.location.href = data.downloadUrl;
        }, 500);
      }
    });

    eventSource.addEventListener('complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      setCurrentJob({
        jobId: data.jobId,
        status: data.status,
        progress: data.progress,
        filesCompleted: data.filesCompleted,
        totalFiles: data.totalFiles,
        downloadUrl: data.downloadUrl,
      });
      eventSource.close();
      
      // Automatically redirect to presigned URL to start download
      if (data.downloadUrl) {
        // Use a small delay to ensure UI updates, then redirect
        setTimeout(() => {
          window.location.href = data.downloadUrl;
        }, 500);
      }
    });

    eventSource.addEventListener('error', (event: MessageEvent | Event) => {
      // Handle both MessageEvent (with data) and generic Event (connection errors)
      if ('data' in event && event.data) {
        const data = JSON.parse(event.data);
        setCurrentJob({
          jobId: data.jobId || jobId,
          status: 'failed',
          progress: 0,
          filesCompleted: 0,
          totalFiles: 0,
          error: data.error || 'Download failed',
        });
      } else {
        // Connection error
        setCurrentJob({
          jobId: jobId,
          status: 'failed',
          progress: 0,
          filesCompleted: 0,
          totalFiles: 0,
          error: 'Connection error',
        });
      }
      eventSource.close();
    });

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  };

  const downloadFile = async (key: string) => {
    await initiateDownload([key]);
  };

  const downloadSelected = async () => {
    if (selectedFiles.size === 0) {
      alert('Please select at least one file');
      return;
    }
    await initiateDownload(Array.from(selectedFiles));
  };

  if (loading) {
    return (
      <div className="app">
        <div className="container">
          <h1>File Downloader</h1>
          <p>Loading files from storage...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="container">
        <h1>File Downloader</h1>
        <p>Select files from the source bucket to download</p>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {currentJob && (
          <div className="job-status">
            <h3>Processing your download...</h3>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${currentJob.progress}%` }}></div>
            </div>
            <p>
              Status: <strong>{currentJob.status}</strong> | 
              Progress: <strong>{currentJob.progress}%</strong> | 
              Files: <strong>{currentJob.filesCompleted}/{currentJob.totalFiles}</strong>
            </p>
            {currentJob.status === 'completed' && currentJob.downloadUrl && (
              <div className="download-ready">
                <p>✅ Download ready! Redirecting to download...</p>
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                  If download doesn't start automatically, 
                  <a href={currentJob.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '5px' }}>
                    click here
                  </a>
                </p>
              </div>
            )}
            {currentJob.status === 'failed' && currentJob.error && (
              <div className="error-message">
                Error: {currentJob.error}
              </div>
            )}
            {currentJob.status !== 'completed' && currentJob.status !== 'failed' && (
              <button 
                onClick={() => setCurrentJob(null)} 
                className="btn btn-secondary"
                style={{ marginTop: '10px' }}
              >
                Close
              </button>
            )}
          </div>
        )}

        <div className="actions">
          <button onClick={selectAll} className="btn btn-secondary">
            {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
          </button>
          <button 
            onClick={downloadSelected} 
            className="btn btn-primary"
            disabled={selectedFiles.size === 0 || currentJob !== null}
          >
            Download Selected ({selectedFiles.size})
          </button>
          <button onClick={fetchFiles} className="btn btn-secondary">
            Refresh
          </button>
        </div>

        {files.length === 0 ? (
          <p className="no-files">No files found in the source bucket.</p>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectedFiles.size === files.length && files.length > 0}
                    onChange={selectAll}
                  />
                </th>
                <th>File Name</th>
                <th>Size</th>
                <th>Last Modified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.key)}
                      onChange={() => toggleFileSelection(file.key)}
                      disabled={currentJob !== null}
                    />
                  </td>
                  <td>{file.key}</td>
                  <td>{formatFileSize(file.size)}</td>
                  <td>{formatDate(file.lastModified)}</td>
                  <td>
                    <button
                      onClick={() => downloadFile(file.key)}
                      className="btn btn-small"
                      disabled={currentJob !== null}
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default App;
