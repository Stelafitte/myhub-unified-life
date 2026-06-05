
CREATE POLICY "own collab-doc-images select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'collab-doc-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own collab-doc-images insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'collab-doc-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own collab-doc-images update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'collab-doc-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "own collab-doc-images delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'collab-doc-images' AND (storage.foldername(name))[1] = auth.uid()::text);
