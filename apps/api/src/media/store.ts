import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Config } from '../config';

export interface ObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  /** Throws when the object does not exist. */
  get(key: string): Promise<Buffer>;
  /** Deleting an object that is already gone is not an error. */
  delete(key: string): Promise<void>;
}

/** A private S3-compatible bucket. Objects are already encrypted by the vault; production also asks the server to encrypt at rest. */
export function createS3Store(
  cfg: Config['s3'],
  opts: { serverSideEncryption?: boolean } = {},
): ObjectStore & {
  ensureBucket(): Promise<void>;
} {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/octet-stream',
          ...(opts.serverSideEncryption ? { ServerSideEncryption: 'AES256' as const } : {}),
        }),
      );
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!out.Body) throw new Error('Empty object body');
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    /** Development, tests and browser tests only; production buckets are made by hand. */
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      }
    },
  };
}

/** The store for a running config. Development, tests and browser tests create their bucket on first use. */
export async function openStore(config: Pick<Config, 'nodeEnv' | 's3'>): Promise<ObjectStore> {
  const store = createS3Store(config.s3, { serverSideEncryption: config.nodeEnv === 'production' });
  if (config.nodeEnv !== 'production') await store.ensureBucket();
  return store;
}
