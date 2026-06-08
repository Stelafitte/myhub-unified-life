
CREATE POLICY "expense-receipts owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "expense-receipts owner write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "expense-receipts owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "expense-receipts owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
