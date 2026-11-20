-- Switches on the booth-agent alert that, under Election Commission rules, the
-- banner on the voter slip is switched off from midnight. Sent to every
-- constituency; agents see it over the app's home screen and tick that they
-- have read it.
--
--   bash scripts/prod-sql.sh run scripts/announcement-banner-off.sql
\set ON_ERROR_STOP on
BEGIN;
-- Prisma reads these columns as UTC; the server's clock is IST.
UPDATE assemblies SET announcement_enabled = true,
  announcement_title = 'బూత్ ఏజెంట్లకు ముఖ్యమైన సూచన',
  announcement_body = $msg$ఎన్నికల సంఘం నిబంధనల ప్రకారం ఓటరు స్లిప్‌పై ఉన్న బ్యానర్‌ను తొలగిస్తున్నాము.

⏰ ఈ రోజు (30-10-2026) అర్ధరాత్రి 12 గంటల నుండి స్లిప్‌పై బ్యానర్ ఆపివేయబడుతుంది.

✅ ఆ తర్వాత ప్రింట్ చేసే స్లిప్‌లలో ఓటరు వివరాలు మాత్రమే ఉంటాయి.

✅ ఇప్పటికే బ్యానర్‌తో ప్రింట్ చేసిన స్లిప్‌లలో బ్యానర్ భాగాన్ని కత్తిరించి, ఓటరు వివరాలు ఉన్న భాగాన్ని మాత్రమే ఓటర్లకు ఇవ్వండి.

దయచేసి ఎన్నికల సంఘం నిబంధనలను తప్పకుండా పాటించండి.

ధన్యవాదాలు,
**Booth Help Desk టీమ్**$msg$,
  announcement_updated_at = (now() AT TIME ZONE 'UTC'), updated_at = (now() AT TIME ZONE 'UTC');
SELECT assembly_no, e_assemblyname, announcement_enabled, announcement_title, announcement_updated_at FROM assemblies ORDER BY assembly_no;
COMMIT;
