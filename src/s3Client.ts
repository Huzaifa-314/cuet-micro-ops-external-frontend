import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// For browser access, use localhost (exposed port)
// The environment variable can be set for Docker, but defaults to localhost for browser
const MINIO_ENDPOINT = import.meta.env.VITE_MINIO_ENDPOINT || 'http://localhost:9000';
const MINIO_ACCESS_KEY = import.meta.env.VITE_MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = import.meta.env.VITE_MINIO_SECRET_KEY || 'minioadmin';
const SOURCE_BUCKET = import.meta.env.VITE_SOURCE_BUCKET || 'source';

// Convert Docker internal hostname to localhost for browser access
const getBrowserEndpoint = (endpoint: string): string => {
  // If running in browser, replace Docker hostnames with localhost
  if (typeof window !== 'undefined') {
    return endpoint.replace(/http:\/\/[^:]+:(\d+)/, 'http://localhost:$1');
  }
  return endpoint;
};

// Create S3 client for direct MinIO access
// Use browser-friendly endpoint (localhost) when running in browser
const browserEndpoint = typeof window !== 'undefined' 
  ? getBrowserEndpoint(MINIO_ENDPOINT)
  : MINIO_ENDPOINT;

export const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: browserEndpoint,
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export interface S3File {
  key: string;
  size: number;
  lastModified: string;
}

// List files from source bucket
export async function listFiles(): Promise<S3File[]> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
    });
    const response = await s3Client.send(command);
    
    const files: S3File[] = 
      response.Contents?.map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? new Date().toISOString(),
      })).filter((f) => f.key && !f.key.endsWith('/')) ?? [];
    
    return files;
  } catch (error) {
    console.error('Error listing files from S3:', error);
    throw error;
  }
}

// Generate presigned URL for download
export async function getDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: key,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
}

// Generate multiple presigned URLs
export async function getBatchDownloadUrls(keys: string[], expiresIn: number = 3600): Promise<Array<{ key: string; url: string }>> {
  try {
    const urls = await Promise.all(
      keys.map(async (key) => {
        const url = await getDownloadUrl(key, expiresIn);
        return { key, url };
      })
    );
    return urls;
  } catch (error) {
    console.error('Error generating batch URLs:', error);
    throw error;
  }
}

