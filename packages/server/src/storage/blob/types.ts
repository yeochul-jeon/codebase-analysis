export interface BlobAdapter {
  /**
   * Persist source.zip for an index.
   * Variant A writes to local FS; Variant B uploads to S3 (Session 5+).
   */
  saveBlob(repoId: number, indexId: number, data: Buffer): Promise<void>;

  /**
   * Extract a single file entry from source.zip by path.
   * Returns undefined if the index or entry does not exist.
   */
  getEntry(repoId: number, indexId: number, filePath: string): Promise<Buffer | undefined>;

  /** Check whether the blob for an index exists. */
  hasBlob(repoId: number, indexId: number): Promise<boolean>;
}
