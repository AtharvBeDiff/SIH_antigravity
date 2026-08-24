-- MPLADS Platform — Storage Buckets

-- Evidence bucket for work photos/documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence',
  'evidence',
  FALSE,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Exports bucket for digest HTML exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exports',
  'exports',
  FALSE,
  10485760,  -- 10MB
  ARRAY['text/html', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "auth_read_evidence" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_evidence" ON storage.objects;

-- Service role has full access by default
-- Authenticated users can read evidence
CREATE POLICY "auth_read_evidence"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'evidence');

-- Authenticated users can upload to evidence (field inspections)
CREATE POLICY "auth_upload_evidence"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'evidence');
