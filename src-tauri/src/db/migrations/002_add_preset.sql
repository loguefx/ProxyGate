-- Add preset column to service_groups (generic / jellyfin / plex / api / static)
ALTER TABLE service_groups ADD COLUMN preset TEXT DEFAULT 'generic';
