-- Migration v56: Allow nullable check_in_time and video_file_id in tk_check_ins
-- Supports client meeting exemptions, manual approvals, and leave-credited attendances.

ALTER TABLE tk_check_ins ALTER COLUMN check_in_time DROP NOT NULL;
ALTER TABLE tk_check_ins ALTER COLUMN check_in_time SET DEFAULT NOW();
ALTER TABLE tk_check_ins ALTER COLUMN video_file_id DROP NOT NULL;
ALTER TABLE tk_check_ins ALTER COLUMN video_file_id SET DEFAULT 'manual';
