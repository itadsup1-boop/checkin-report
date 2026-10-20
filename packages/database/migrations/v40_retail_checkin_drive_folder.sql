BEGIN;

ALTER TABLE public.retail_checkins
    ADD COLUMN IF NOT EXISTS drive_folder_url TEXT;

COMMIT;
